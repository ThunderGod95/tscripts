import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { exec } from 'child_process';
import clipboardy from 'clipboardy';
import AhoCorasick from 'ahocorasick';
import { ratio } from 'fuzzball';
import path from 'path';
import * as readline from 'readline';

import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';

interface MatchResult {
    term: string;
    start: number;
    end: number;
}
interface GlossaryEntry {
    cn?: string;
    en?: string;
    pinyin?: string;
    type?: string;
    gender?: string;
}

function preprocessChineseText(text: string): string {
    return text
        .normalize('NFKC')
        .replace(/[^\p{Script=Han}\p{P}\p{N}]/gu, '')
        .replace(/\s+/g, '')
        .trim();
}

function ahoCorasickFindAll(
    terms: string[],
    text: string
): MatchResult[] {
    const cleanText = preprocessChineseText(text);

    const cleanToOriginalMap = new Map<string, string>();
    for (const originalTerm of terms) {
        const cleanTerm = preprocessChineseText(originalTerm);
        if (cleanTerm.length > 0) {
            cleanToOriginalMap.set(cleanTerm, originalTerm);
        }
    }

    const validCleanTerms = Array.from(cleanToOriginalMap.keys());

    if (validCleanTerms.length === 0) {
        return [];
    }

    const ac = new AhoCorasick(validCleanTerms);

    const foundMatches: MatchResult[] = [];
    const results = ac.search(cleanText);

    for (const [endIndex, matchedTerms] of results) {
        for (const cleanTerm of matchedTerms) {
            const originalTerm = cleanToOriginalMap.get(cleanTerm);

            if (originalTerm) {
                const startIndex = endIndex - [...cleanTerm].length + 1;
                foundMatches.push({
                    term: originalTerm,
                    start: startIndex,
                    end: endIndex
                });
            }
        }
    }
    return foundMatches;
}

function chineseFuzzySearch(
    terms: string[],
    text: string,
    jieba: Jieba,
    threshold: number = 85
): Set<string> {
    const foundTerms = new Set<string>();
    const cleanText = preprocessChineseText(text);

    const textWords = jieba.cut(cleanText, true);
    const uniqueTextWords = new Set(textWords);

    const cleanTerms = new Map<string, string>();
    for (const term of terms) {
        cleanTerms.set(term, preprocessChineseText(term));
    }

    for (const [originalTerm, term] of cleanTerms.entries()) {
        if (term.length === 0) continue;

        for (const word of uniqueTextWords) {
            const score = ratio(term, word);
            if (score >= threshold) {
                foundTerms.add(originalTerm);
                break;
            }
        }
    }
    return foundTerms;
}

function calculateChineseCharSimilarity(term: string[], window: string[]): number {
    if (term.length !== window.length) return 0;
    let exactMatches = 0;
    let partialMatches = 0;
    for (let i = 0; i < term.length; i++) {
        if (term[i] === window[i]) {
            exactMatches++;
        } else if (areChineseCharsSimilar(term[i]!, window[i]!)) {
            partialMatches += 0.5;
        }
    }
    return (exactMatches + partialMatches) / term.length;
}

function areChineseCharsSimilar(char1: string, char2: string): boolean {
    const char1Code = char1.codePointAt(0) || 0;
    const char2Code = char2.codePointAt(0) || 0;
    return Math.abs(char1Code - char2Code) < 100;
}

function chineseNGramSearch(
    terms: string[],
    text: string
): Set<string> {
    const foundTerms = new Set<string>();
    const cleanText = preprocessChineseText(text);
    for (const term of terms) {
        const cleanTerm = preprocessChineseText(term);
        if (cleanText.includes(cleanTerm)) {
            foundTerms.add(term);
            continue;
        }
        if ([...cleanTerm].length <= 4) {
            if (hasChineseCharacterPermutation(cleanTerm, cleanText)) {
                foundTerms.add(term);
            }
        }
    }
    return foundTerms;
}

function hasChineseCharacterPermutation(term: string, text: string): boolean {
    const termChars = [...term];
    const textChars = [...text];
    for (let i = 0; i < textChars.length - termChars.length + 1; i++) {
        const window = textChars.slice(i, i + termChars.length * 2);
        let matchCount = 0;
        for (const char of termChars) {
            if (window.includes(char)) {
                matchCount++;
            }
        }
        if (matchCount >= termChars.length * 0.8) {
            return true;
        }
    }
    return false;
}

function openInVSCode(filePath: string): Promise<void> {
    return new Promise((resolve) => {
        const command = `code "${filePath}"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.warn(`\n⚠️  Could not open file in VS Code. Is the 'code' command in your system's PATH?`);
                resolve();
                return;
            }
            console.log(`✅ Attempting to open new chapter file in VS Code...`);
            resolve();
        });
    });
}

function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans.trim());
    }));
}

async function verifyChapterNumber(
    chapterText: string,
    translationFolderPath: string
): Promise<{ correctedText: string; chapterNumber: number }> {
    console.log('\nVerifying chapter number...');

    const files = readdirSync(translationFolderPath);
    const chapterNumbers = files
        .map(file => file.endsWith('.md') ? parseInt(file, 10) : NaN)
        .filter(num => !isNaN(num));

    const lastChapterNumber = chapterNumbers.length > 0 ? Math.max(...chapterNumbers) : 0;
    const expectedChapterNumber = lastChapterNumber + 1;

    const firstLine = chapterText.split('\n')[0]?.trim() || '';
    const match = firstLine.match(/\d+/);
    const actualChapterNumber = match ? parseInt(match[0], 10) : null;

    if (actualChapterNumber === null) {
        throw new Error(`Could not find a chapter number in the first line: "${firstLine}"`);
    }

    console.log(`Last translated chapter was: ${lastChapterNumber}.`);
    console.log(`Expected next chapter is: ${expectedChapterNumber}.`);
    console.log(`Found chapter in current file: ${actualChapterNumber}.`);

    if (actualChapterNumber !== expectedChapterNumber) {
        console.warn(`\n⚠️  Chapter number mismatch!`);
        const answer = await askQuestion('Do you want to automatically correct this? (y/n): ');

        if (answer.toLowerCase() === 'y') {
            const correctedFirstLine = firstLine.replace(actualChapterNumber.toString(), expectedChapterNumber.toString());
            const correctedText = chapterText.replace(firstLine, correctedFirstLine);
            console.log('✅ Chapter number corrected in text.');
            return { correctedText, chapterNumber: expectedChapterNumber };
        } else {
            throw new Error('Aborted by user due to chapter number mismatch.');
        }
    }

    console.log('✅ Chapter number is correct.');
    return { correctedText: chapterText, chapterNumber: actualChapterNumber };
}


const MAIN_PATH = 'C:\\Users\\tarun\\CodingProjects\\nt\\translations\\TheMirrorLegacy\\assets\\';
const TRANSLATION_PATH = 'C:\\Users\\tarun\\CodingProjects\\nt\\translations\\TheMirrorLegacy\\translations';

async function processAndCopy(): Promise<void> {
    try {
        console.log('Loading Chinese segmenter dictionary...');
        const jieba = Jieba.withDict(dict);
        console.log('Dictionary loaded.');

        const glossaryData = readFileSync(path.resolve(MAIN_PATH, 'glossary.json'), 'utf-8');
        const glossaryList: GlossaryEntry[] = JSON.parse(glossaryData);

        const glossaryMap: Record<string, GlossaryEntry> = {};
        for (const entry of glossaryList) {
            if (entry.cn) {
                glossaryMap[entry.cn] = entry;
            }
        }

        const glossaryTerms = Object.keys(glossaryMap);
        console.log(`Loaded ${Object.keys(glossaryMap).length} main glossary entries.`);

        const originalChapterText = readFileSync(path.resolve(MAIN_PATH, 'cr_ch.txt'), 'utf-8');
        console.log('Loaded chapter file.');

        const { correctedText, chapterNumber } = await verifyChapterNumber(originalChapterText, TRANSLATION_PATH);
        let chapterText = correctedText; // Use the corrected text for all subsequent operations

        console.log('\n--- Starting Glossary Search ---');
        console.time('Phase 1 (Chinese Exact)');
        const exactMatchesDetails = ahoCorasickFindAll(glossaryTerms, chapterText);
        const foundExactInText = new Set(exactMatchesDetails.map(match => match.term));
        console.timeEnd('Phase 1 (Chinese Exact)');
        console.log(`Phase 1 (Chinese Exact): Found ${foundExactInText.size} unique exact terms.`);

        const termsForFuzzy = glossaryTerms.filter(term => !foundExactInText.has(term));
        console.time('Phase 2 (Chinese Fuzzy)');
        const foundFuzzyInText = chineseFuzzySearch(termsForFuzzy, chapterText, jieba, 75);
        console.timeEnd('Phase 2 (Chinese Fuzzy)');
        console.log(`Phase 2 (Chinese Fuzzy): Found ${foundFuzzyInText.size} fuzzy matched terms.`);

        const termsForNGram = termsForFuzzy.filter(term => !foundFuzzyInText.has(term));
        console.time('Phase 3 (Chinese N-gram)');
        const foundNGramInText = chineseNGramSearch(termsForNGram, chapterText);
        console.timeEnd('Phase 3 (Chinese N-gram)');
        console.log(`Phase 3 (Chinese N-gram): Found ${foundNGramInText.size} n-gram matched terms.`);

        const allFoundTerms = new Set([...foundExactInText, ...foundFuzzyInText, ...foundNGramInText]);
        console.log(`\nTotal unique glossary terms after all phases: ${allFoundTerms.size}`);

        const foundEntriesList = Array.from(allFoundTerms)
            .sort((a, b) => {
                const aLen = [...(preprocessChineseText(a))].length;
                const bLen = [...(preprocessChineseText(b))].length;
                return bLen - aLen || a.localeCompare(b);
            })
            .map(term => glossaryMap[term]);

        console.log('\n--- Final Micro-Glossary Terms ---');
        for (const entry of foundEntriesList) {
            if (!entry) continue;
            const cn = entry.cn || '???';
            const en = entry.en || '???';
            console.log(`* ${cn} - ${en}`);
        }

        const microGlossaryString = foundEntriesList
            .map(entry => {
                if (!entry) return '';
                const cn = entry.cn || '???';
                const pinyin = entry.pinyin || '???';
                const en = entry.en || '???';
                const type = entry.type || '';
                const gender = entry.gender || '';
                return `* ${cn} (${pinyin}) -> ${en} [${type}, ${gender}]`.trim();
            })
            .filter(line => line)
            .join('\n');

        const promptTemplate = readFileSync(path.resolve(MAIN_PATH, 'translation_prompt.md'), 'utf-8');
        const finalPromptString =
            `${promptTemplate}\n\n` +
            `**Glossary:**\n` +
            `${microGlossaryString}\n\n` +
            `---\n\n` +
            `**Chinese Chapter to Translate:**\n` +
            `${chapterText}`;

        await clipboardy.write(finalPromptString);

        console.log('\n' + '='.repeat(50));
        console.log('✅ SUCCESS! The prompt has been copied to clipboard.');
        console.log(`Total glossary entries: ${foundEntriesList.length}`);


        const newFilePath = path.join(TRANSLATION_PATH, `${chapterNumber}.md`);

        if (existsSync(newFilePath)) {
            console.warn(`⚠️  Warning: File '${path.basename(newFilePath)}' already exists. Skipping creation.`);
        } else {
            writeFileSync(newFilePath, '');
            console.log(`✅ Created empty file for new chapter: ${path.basename(newFilePath)}`);
            await openInVSCode(newFilePath);
        }
        console.log('='.repeat(50));

    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.error('\n--- ❌ ERROR: FILE NOT FOUND ---');
            console.error(`Please ensure the file '${error.path}' exists and try again.`);
        } else {
            console.error(`\n--- ❌ ERROR ---`);
            console.error(error.message);
        }
    }
}

if (import.meta.main) {
    await processAndCopy();
}