export const IMAGE_SIZE_OPTIONS = [
    { id: 'small', label: 'Nhỏ 35%' },
    { id: 'medium', label: 'Vừa 55%' },
    { id: 'large', label: 'Lớn 78%' },
    { id: 'full', label: 'Toàn chiều ngang' },
];

export const IMAGE_ALIGN_OPTIONS = [
    { id: 'left', label: 'Căn trái' },
    { id: 'center', label: 'Căn giữa' },
    { id: 'right', label: 'Căn phải' },
];

export const DEFAULT_IMAGE_SIZE = 'large';
export const DEFAULT_IMAGE_ALIGN = 'center';

function replaceExtension(fileName, nextExtension) {
    const safeName = (fileName || 'image').replace(/\.[^.]+$/, '');
    return `${safeName}.${nextExtension}`;
}

export function getStorageSafeImageName(fileName) {
    return (fileName || 'image')
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/_+/g, '_');
}

export function buildImageStyle({ size = DEFAULT_IMAGE_SIZE, align = DEFAULT_IMAGE_ALIGN } = {}) {
    const widthBySize = {
        small: '35%',
        medium: '55%',
        large: '78%',
        full: '100%',
    };
    const marginByAlign = {
        left: '12px auto 12px 0',
        center: '12px auto',
        right: '12px 0 12px auto',
    };

    const width = widthBySize[size] || widthBySize[DEFAULT_IMAGE_SIZE];
    const margin = marginByAlign[align] || marginByAlign[DEFAULT_IMAGE_ALIGN];

    return `display:block;width:${width};max-width:100%;height:auto;object-fit:contain;margin:${margin};border-radius:12px;`;
}

export function buildImageTag(src, options = {}) {
    return `<img src="${src}" style="${buildImageStyle(options)}" />`;
}

export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Không thể đọc ảnh'));
        reader.readAsDataURL(blob);
    });
}

function loadImageElement(objectUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Không thể tải ảnh để tối ưu'));
        image.src = objectUrl;
    });
}

export async function optimizeImageFile(fileOrBlob, options = {}) {
    const source = fileOrBlob;
    const fileName = options.fileName || source?.name || 'image.png';
    const mime = source?.type || 'image/png';

    if (mime === 'image/webp' || mime === 'image/svg+xml' || mime === 'image/gif') {
        return {
            blob: source,
            mime,
            name: fileName,
            converted: false,
        };
    }

    const objectUrl = URL.createObjectURL(source);
    try {
        const image = await loadImageElement(objectUrl);
        const maxWidth = options.maxWidth || 1600;
        const maxHeight = options.maxHeight || 1600;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const optimizedBlob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/webp', options.quality || 0.82);
        });

        return {
            blob: optimizedBlob || source,
            mime: optimizedBlob ? 'image/webp' : mime,
            name: optimizedBlob ? replaceExtension(fileName, 'webp') : fileName,
            converted: Boolean(optimizedBlob),
        };
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}