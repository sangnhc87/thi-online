const USD_TO_VND = 26000;
const FIRESTORE_READ_USD_PER_100K = 0.06;
const FIRESTORE_WRITE_USD_PER_100K = 0.18;
const STORAGE_USD_PER_GB_MONTH = 0.026;

export function formatBytes(bytes = 0) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatCurrencyVnd(value = 0) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
}

export function estimateTeacherCost(stats = {}) {
    const storageBytes = stats.storageBytes || 0;
    const estimatedReadOps = stats.estimatedReadOps || 0;
    const estimatedWriteOps = stats.estimatedWriteOps || 0;

    const storageUsd = (storageBytes / (1024 ** 3)) * STORAGE_USD_PER_GB_MONTH;
    const readsUsd = (estimatedReadOps / 100000) * FIRESTORE_READ_USD_PER_100K;
    const writesUsd = (estimatedWriteOps / 100000) * FIRESTORE_WRITE_USD_PER_100K;
    const totalUsd = storageUsd + readsUsd + writesUsd;

    return {
        storageUsd,
        readsUsd,
        writesUsd,
        totalUsd,
        totalVnd: totalUsd * USD_TO_VND,
    };
}

export function getUsageTier(stats = {}) {
    const score = (stats.sessionCount || 0) * 2 + Math.round((stats.storageBytes || 0) / (1024 * 1024 * 25));
    if (score >= 600) return { label: 'Rất cao', className: 'danger' };
    if (score >= 250) return { label: 'Cao', className: 'warning' };
    if (score >= 80) return { label: 'Trung bình', className: 'info' };
    return { label: 'Thấp', className: 'success' };
}