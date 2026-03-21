"use node";

import dns from "node:dns/promises";
import net from "node:net";

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 5;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const YOUTUBE_HOSTNAMES = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);
const YOUTUBE_THUMBNAIL_FILENAMES = [
  "maxresdefault.jpg",
  "hqdefault.jpg",
  "mqdefault.jpg",
  "default.jpg",
] as const;

type Preview = {
  title?: string;
  description?: string;
  image?: string;
};

type YouTubeVideo = {
  videoId: string;
  canonicalUrl: string;
};

export const scrapeEntry = internalAction({
  args: {
    entryId: v.id("entries"),
    url: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scrapedAt = Date.now();

    try {
      const normalizedUrl = normalizeHttpUrl(args.url);
      const youtubeVideo = parseYouTubeVideoUrl(normalizedUrl);
      let youtubePreviewFailed = false;
      const previewResult =
        (youtubeVideo
          ? await fetchYouTubePreview(youtubeVideo).catch((error) => {
              youtubePreviewFailed = true;
              console.warn("YouTube preview lookup failed, falling back to HTML.", {
                url: args.url,
                videoId: youtubeVideo.videoId,
                error: getErrorMessage(error),
              });
              return null;
            })
          : null) ?? (await fetchGenericPreview(normalizedUrl));

      if (youtubePreviewFailed) {
        console.info("Generic preview fallback used for YouTube URL.", {
          url: args.url,
        });
      }

      await savePreview(ctx, {
        entryId: args.entryId,
        url: youtubeVideo ? args.url : previewResult.url,
        preview: previewResult.preview,
        scrapedAt,
      });
    } catch {
      await ctx.runMutation(internal.entries.saveLinkPreview, {
        entryId: args.entryId,
        metadata: {
          url: args.url,
          scrapeStatus: "failed",
          scrapedAt,
        },
      });
      console.error("Link preview scrape failed.", {
        url: args.url,
      });
    }

    return null;
  },
});

async function savePreview(
  ctx: ActionCtx,
  args: {
    entryId: Id<"entries">;
    url: string;
    preview: Preview;
    scrapedAt: number;
  },
) {
  const hasPreview =
    args.preview.title !== undefined ||
    args.preview.description !== undefined ||
    args.preview.image !== undefined;

  console.info("Saving link preview metadata.", {
    entryId: args.entryId,
    url: args.url,
    scrapeStatus: hasPreview ? "success" : "failed",
    title: args.preview.title,
    hasDescription: args.preview.description !== undefined,
    image: args.preview.image,
  });

  await ctx.runMutation(internal.entries.saveLinkPreview, {
    entryId: args.entryId,
    metadata: {
      url: args.url,
      scrapeStatus: hasPreview ? "success" : "failed",
      scrapedAt: args.scrapedAt,
      ...(args.preview.title ? { title: args.preview.title } : {}),
      ...(args.preview.description
        ? { description: args.preview.description }
        : {}),
      ...(args.preview.image ? { image: args.preview.image } : {}),
    },
  });
}

async function fetchGenericPreview(url: string) {
  const { html, finalUrl } = await fetchHtml(url);

  return {
    url: finalUrl,
    preview: extractPreview(html, finalUrl),
  };
}

async function fetchHtml(url: string) {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHttpUrl(currentUrl);

    const response = await fetch(currentUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": DEFAULT_USER_AGENT,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");

      if (!location) {
        throw new Error("Redirect response is missing a location header.");
      }

      currentUrl = normalizeHttpUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch preview (${response.status}).`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error("Preview target did not return HTML.");
    }

    return {
      html: await response.text(),
      finalUrl: normalizeHttpUrl(response.url || currentUrl),
    };
  }

  throw new Error("Too many redirects while fetching preview.");
}

async function fetchYouTubePreview(video: YouTubeVideo) {
  const { html, finalUrl } = await fetchHtml(video.canonicalUrl);
  const preview = extractPreview(html, finalUrl);
  const rawMetaTitle = extractRawMetaContent(html, [
    ["property", "og:title"],
    ["name", "twitter:title"],
    ["name", "title"],
    ["itemprop", "name"],
  ]);
  const playerTitle = extractYouTubePlayerTitle(html, video.videoId);
  const documentTitle = extractTitle(html);
  const title =
    sanitizeYouTubeTitle(rawMetaTitle) ??
    sanitizeYouTubeTitle(playerTitle) ??
    sanitizeYouTubeTitle(documentTitle) ??
    sanitizeYouTubeTitle(preview.title);
  const image = await resolveYouTubeThumbnail(video.videoId, preview.image);

  console.info("YouTube preview extraction result.", {
    videoId: video.videoId,
    canonicalUrl: finalUrl,
    rawMetaTitle,
    previewTitle: preview.title,
    playerTitle,
    documentTitle,
    finalTitle: title,
    previewImage: preview.image,
    finalImage: image,
  });

  if (!title && !image) {
    throw new Error("YouTube watch page did not include preview data.");
  }

  return {
    url: video.canonicalUrl,
    preview: {
      ...(title ? { title } : {}),
      ...(image ? { image } : {}),
    },
  };
}

async function resolveYouTubeThumbnail(videoId: string, fallbackImage?: string) {
  const [preferredFilename, ...fallbackFilenames] = YOUTUBE_THUMBNAIL_FILENAMES;
  const preferredImageUrl = `https://i.ytimg.com/vi/${videoId}/${preferredFilename}`;

  if (await isUsableImage(preferredImageUrl)) {
    return preferredImageUrl;
  }

  if (fallbackImage) {
    return fallbackImage;
  }

  for (const filename of fallbackFilenames) {
    const imageUrl = `https://i.ytimg.com/vi/${videoId}/${filename}`;

    if (await isUsableImage(imageUrl)) {
      return imageUrl;
    }
  }

  return undefined;
}

async function isUsableImage(url: string) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "user-agent": DEFAULT_USER_AGENT,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return false;
    }

    const contentType = response.headers.get("content-type") ?? "";
    return contentType.startsWith("image/");
  } catch {
    return false;
  }
}

async function assertPublicHttpUrl(url: string) {
  const parsedUrl = normalizeUrl(url);

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Localhost URLs are not allowed.");
  }

  if (net.isIP(hostname)) {
    if (!isPublicIp(hostname)) {
      throw new Error("Private IP addresses are not allowed.");
    }
    return;
  }

  const lookups = await dns.lookup(hostname, { all: true, verbatim: true });

  if (lookups.length === 0) {
    throw new Error("Could not resolve host.");
  }

  for (const lookup of lookups) {
    if (!isPublicIp(lookup.address)) {
      throw new Error("Resolved address points to a private network.");
    }
  }
}

function normalizeHttpUrl(url: string) {
  return normalizeUrl(url).toString();
}

function normalizeUrl(url: string) {
  const parsedUrl = new URL(url);

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }

  return parsedUrl;
}

function isRedirect(status: number) {
  return status >= 300 && status < 400;
}

function isPublicIp(address: string) {
  if (address.toLowerCase().startsWith("::ffff:")) {
    return isPublicIp(address.slice(7));
  }

  const family = net.isIP(address);

  if (family === 4) {
    return isPublicIpv4(address);
  }

  if (family === 6) {
    return isPublicIpv6(address);
  }

  return false;
}

function isPublicIpv4(address: string) {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));

  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return false;
  }

  const [first, second] = octets;

  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  ) {
    return false;
  }

  return true;
}

function isPublicIpv6(address: string) {
  const normalized = address.toLowerCase();

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return false;
  }

  return true;
}

function extractPreview(html: string, pageUrl: string) {
  const metaTags = Array.from(html.matchAll(/<meta\b[^>]*>/gi), (match) =>
    parseAttributes(match[0]),
  );
  const jsonLdBlocks = Array.from(
    html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
    (match) => match[1],
  );

  const title =
    findMetaContent(metaTags, "property", "og:title") ??
    findMetaContent(metaTags, "name", "twitter:title") ??
    findMetaContent(metaTags, "name", "title") ??
    findMetaContent(metaTags, "itemprop", "name") ??
    extractJsonLdText(jsonLdBlocks, ["headline", "name"]) ??
    extractTitle(html);
  const description =
    findMetaContent(metaTags, "property", "og:description") ??
    findMetaContent(metaTags, "name", "twitter:description") ??
    findMetaContent(metaTags, "name", "description") ??
    findMetaContent(metaTags, "itemprop", "description") ??
    extractJsonLdText(jsonLdBlocks, ["description"]);
  const image = resolveImageUrl(
    findMetaContent(metaTags, "property", "og:image") ??
      findMetaContent(metaTags, "name", "twitter:image") ??
      findMetaContent(metaTags, "itemprop", "thumbnailurl") ??
      extractJsonLdImage(jsonLdBlocks),
    pageUrl,
  );

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
  };
}

function extractYouTubePlayerTitle(html: string, videoId: string) {
  const escapedVideoId = escapeRegExp(videoId);
  const exactVideoDetailsMatch = html.match(
    new RegExp(
      `"videoDetails":\\{"videoId":"${escapedVideoId}","title":"((?:\\\\.|[^"\\\\])*)"`,
    ),
  );

  if (exactVideoDetailsMatch?.[1]) {
    return decodeJsonString(exactVideoDetailsMatch[1]);
  }

  const overlayTitleMatch = html.match(
    /"playerOverlayVideoDetailsRenderer":\{"title":\{"simpleText":"((?:\\.|[^"\\])*)"/,
  );

  if (overlayTitleMatch?.[1]) {
    return decodeJsonString(overlayTitleMatch[1]);
  }

  const match = html.match(
    /"videoDetails":\{[\s\S]*?"title":"((?:\\.|[^"\\])*)"/,
  );

  if (!match?.[1]) {
    return undefined;
  }

  return decodeJsonString(match[1]);
}

function decodeJsonString(value: string) {
  try {
    return cleanText(JSON.parse(`"${value}"`));
  } catch {
    return cleanText(value.replace(/\\"/g, '"'));
  }
}

function sanitizeYouTubeTitle(title: string | undefined) {
  const cleanedTitle = cleanText(title);

  if (!cleanedTitle) {
    return undefined;
  }

  if (/^-+\s*youtube$/i.test(cleanedTitle)) {
    return undefined;
  }

  const withoutSuffix = cleanedTitle.replace(/\s+-\s+YouTube$/i, "").trim();

  if (
    !withoutSuffix ||
    withoutSuffix === "-" ||
    /^youtube$/i.test(withoutSuffix)
  ) {
    return undefined;
  }

  return withoutSuffix;
}

function extractRawMetaContent(
  html: string,
  selectors: Array<[attributeName: string, attributeValue: string]>,
) {
  for (const [attributeName, attributeValue] of selectors) {
    const match = html.match(
      new RegExp(
        `<meta\\b(?=[^>]*\\b${attributeName}=["']${escapeRegExp(attributeValue)}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`,
        "i",
      ),
    );

    const content = cleanText(match?.[1]);
    if (content) {
      return content;
    }
  }

  return undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseYouTubeVideoUrl(url: string): YouTubeVideo | null {
  const parsedUrl = normalizeUrl(url);
  const hostname = parsedUrl.hostname.toLowerCase();

  if (hostname === "youtu.be") {
    const videoId = parsedUrl.pathname.split("/").filter(Boolean)[0];
    return buildYouTubeVideo(videoId);
  }

  if (!YOUTUBE_HOSTNAMES.has(hostname)) {
    return null;
  }

  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);

  if (parsedUrl.pathname === "/watch") {
    return buildYouTubeVideo(parsedUrl.searchParams.get("v"));
  }

  if (pathSegments[0] === "shorts" || pathSegments[0] === "embed") {
    return buildYouTubeVideo(pathSegments[1]);
  }

  return null;
}

function buildYouTubeVideo(videoId: string | null | undefined): YouTubeVideo | null {
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  const attributeRegex =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (const match of tag.matchAll(attributeRegex)) {
    const [, rawName, doubleQuoted, singleQuoted, bareValue] = match;
    const name = rawName.toLowerCase();
    const value = doubleQuoted ?? singleQuoted ?? bareValue ?? "";
    attributes[name] = value;
  }

  return attributes;
}

function findMetaContent(
  tags: Array<Record<string, string>>,
  attributeName: "property" | "name" | "itemprop",
  attributeValue: string,
) {
  const normalizedAttributeValue = attributeValue.toLowerCase();

  for (const tag of tags) {
    if (tag[attributeName]?.toLowerCase() === normalizedAttributeValue) {
      const content = cleanText(tag.content);
      if (content) {
        return content;
      }
    }
  }

  return undefined;
}

function extractJsonLdText(blocks: string[], keys: string[]) {
  for (const entry of parseJsonLdEntries(blocks)) {
    for (const key of keys) {
      const value = readJsonLdValue(entry, key);
      const text = coerceString(value);

      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

function extractJsonLdImage(blocks: string[]) {
  for (const entry of parseJsonLdEntries(blocks)) {
    const thumbnailUrl = readJsonLdValue(entry, "thumbnailUrl");
    const image = readJsonLdValue(entry, "image");

    for (const candidate of [thumbnailUrl, image]) {
      const imageUrl = coerceImage(candidate);
      if (imageUrl) {
        return imageUrl;
      }
    }
  }

  return undefined;
}

function parseJsonLdEntries(blocks: string[]) {
  const entries: unknown[] = [];

  for (const block of blocks) {
    const normalizedBlock = block.trim();

    if (!normalizedBlock) {
      continue;
    }

    try {
      const parsed = JSON.parse(normalizedBlock);
      collectJsonLdEntries(parsed, entries);
    } catch {
      continue;
    }
  }

  return entries;
}

function collectJsonLdEntries(value: unknown, entries: unknown[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdEntries(item, entries);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  entries.push(value);

  const graph = (value as { "@graph"?: unknown })["@graph"];
  if (Array.isArray(graph)) {
    for (const item of graph) {
      collectJsonLdEntries(item, entries);
    }
  }
}

function readJsonLdValue(entry: unknown, key: string) {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }

  const objectEntry = entry as Record<string, unknown>;
  return objectEntry[key];
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return cleanText(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = coerceString(item);
      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

function coerceImage(value: unknown): string | undefined {
  if (typeof value === "string") {
    return cleanText(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const image = coerceImage(item);
      if (image) {
        return image;
      }
    }
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;

    for (const key of ["url", "contentUrl", "thumbnailUrl"]) {
      const image = coerceImage(objectValue[key]);
      if (image) {
        return image;
      }
    }
  }

  return undefined;
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  return cleanText(match?.[1]);
}

function resolveImageUrl(image: string | undefined, pageUrl: string) {
  if (!image) {
    return undefined;
  }

  try {
    return normalizeHttpUrl(new URL(image, pageUrl).toString());
  } catch {
    return undefined;
  }
}

function cleanText(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const withoutTags = value.replace(/<[^>]+>/g, " ");
  const normalized = decodeHtmlEntities(withoutTags)
    .replace(/\s+/g, " ")
    .trim();

  return normalized || undefined;
}

function decodeHtmlEntities(value: string) {
  return value.replace(
    /&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, code) => {
      const normalizedCode = String(code).toLowerCase();

      switch (normalizedCode) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        case "nbsp":
          return " ";
        default:
          if (normalizedCode.startsWith("#x")) {
            return String.fromCodePoint(
              Number.parseInt(normalizedCode.slice(2), 16),
            );
          }

          if (normalizedCode.startsWith("#")) {
            return String.fromCodePoint(
              Number.parseInt(normalizedCode.slice(1), 10),
            );
          }

          return entity;
      }
    },
  );
}
