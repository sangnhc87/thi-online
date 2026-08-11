function normalizeAssetRef(asset = {}) {
    const path = asset.path || getStoragePathFromUrl(asset.url);
    if (!path) return null;

    return {
        path,
        url: asset.url || null,
        size: Number(asset.size) || 0,
        mime: asset.mime || null,
        uploadedAt: asset.uploadedAt || null,
    };
}

export function getStoragePathFromUrl(url = '') {
    if (!url) return null;

    if (url.startsWith('gs://')) {
        return url.replace(/^gs:\/\/[^/]+\//, '');
    }

    try {
        const decodedUrl = decodeURIComponent(url);
        const match = decodedUrl.match(/\/o\/([^?]+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

export function extractImageUrlsFromHtml(html = '') {
    const matches = [...(html || '').matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
    return matches.map((match) => match[1]).filter(Boolean);
}

export function normalizeExamAssetRefs(assetRefs = []) {
    const deduped = new Map();

    (assetRefs || []).forEach((asset) => {
        const normalized = normalizeAssetRef(asset);
        if (!normalized) return;
        deduped.set(normalized.path, {
            ...(deduped.get(normalized.path) || {}),
            ...normalized,
        });
    });

    return Array.from(deduped.values());
}

export function mergeExamAssetRefs(existingAssetRefs = [], appendedAssetRefs = []) {
    return normalizeExamAssetRefs([
        ...normalizeExamAssetRefs(existingAssetRefs),
        ...normalizeExamAssetRefs(appendedAssetRefs),
    ]);
}

export function buildExamAssetRefs({ questions = [], existingAssetRefs = [], uploadedAssets = [] } = {}) {
    const knownAssets = new Map(
        normalizeExamAssetRefs([...existingAssetRefs, ...uploadedAssets]).map((asset) => [asset.path, asset]),
    );
    const nextAssets = [];
    const seen = new Set();

    (questions || []).forEach((question) => {
        [question.content_html, question.explanation_html, ...(question.choices || []).map((choice) => choice.html)]
            .flatMap((html) => extractImageUrlsFromHtml(html || ''))
            .forEach((url) => {
                const path = getStoragePathFromUrl(url);
                if (!path || seen.has(path)) return;
                seen.add(path);
                nextAssets.push({
                    ...(knownAssets.get(path) || {}),
                    path,
                    url: knownAssets.get(path)?.url || url,
                });
            });
    });

    return normalizeExamAssetRefs(nextAssets);
}

export function summarizeExamAssets(assetRefs = [], previousSummary = {}) {
    const normalized = normalizeExamAssetRefs(assetRefs);
    return {
        imageCount: normalized.length,
        imageBytes: normalized.reduce((sum, asset) => sum + (Number(asset.size) || 0), 0),
        storageReused: Boolean(previousSummary?.storageReused),
    };
}