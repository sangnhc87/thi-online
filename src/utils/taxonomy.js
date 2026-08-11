import { Timestamp, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const TAXONOMY_CONFIG_ID = 'taxonomy';

export const DEFAULT_TAXONOMY = {
    grades: [
        'Lớp 6',
        'Lớp 7',
        'Lớp 8',
        'Lớp 9',
        'Lớp 10',
        'Lớp 11',
        'Lớp 12',
        'Đại học',
        'Khác',
    ],
    subjects: [
        'Toán',
        'Ngữ văn',
        'Tiếng Anh',
        'Vật lý',
        'Hóa học',
        'Sinh học',
        'Lịch sử',
        'Địa lý',
        'GDCD',
        'Tin học',
        'Công nghệ',
        'Khác',
    ],
};

function uniqueSortedList(values = []) {
    return [...new Set(
        values
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean)
    )].sort((left, right) => left.localeCompare(right, 'vi'));
}

export function normalizeTaxonomyConfig(data = {}) {
    const grades = uniqueSortedList(data.grades?.length ? data.grades : DEFAULT_TAXONOMY.grades);
    const subjects = uniqueSortedList(data.subjects?.length ? data.subjects : DEFAULT_TAXONOMY.subjects);

    return {
        grades,
        subjects,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null,
        updatedByName: data.updatedByName || null,
    };
}

export function parseTaxonomyTextarea(text = '') {
    return uniqueSortedList(text.split(/\r?\n/));
}

export function formatTaxonomyTextarea(values = []) {
    return uniqueSortedList(values).join('\n');
}

export function mergeTaxonomyOptions(values = [], currentValue = '') {
    const normalized = uniqueSortedList(values);
    const current = typeof currentValue === 'string' ? currentValue.trim() : '';
    if (!current || normalized.includes(current)) return normalized;
    return [current, ...normalized];
}

export async function loadTaxonomyConfig() {
    const snapshot = await getDoc(doc(db, 'systemConfigs', TAXONOMY_CONFIG_ID));
    if (!snapshot.exists()) return normalizeTaxonomyConfig(DEFAULT_TAXONOMY);
    return normalizeTaxonomyConfig(snapshot.data());
}

export async function saveTaxonomyConfig({ grades = [], subjects = [], user }) {
    const normalized = normalizeTaxonomyConfig({ grades, subjects });
    await setDoc(doc(db, 'systemConfigs', TAXONOMY_CONFIG_ID), {
        ...normalized,
        updatedAt: Timestamp.now(),
        updatedBy: user?.uid || null,
        updatedByName: user?.displayName || user?.email || null,
    }, { merge: true });
    return normalized;
}