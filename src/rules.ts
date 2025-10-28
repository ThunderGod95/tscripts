import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { execFile } from "child_process";
import clipboardy from "clipboardy";
import AhoCorasick from "ahocorasick";
import { ratio } from "fuzzball";
import path from "path";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";

const GLOSSARY_FILE = "glossary.json";
const CHAPTER_FILE = "cr_ch.txt";
const PROMPT_FILE = "translation_prompt.md";

const FUZZY_SEARCH_THRESHOLD = 75;
const NGRAM_SEARCH_MAX_LENGTH = 4; // Max length of term to check for subsequences

// Matches a full chapter block, starting with "第...章" on a line
// and ending with "(本章完)" on a line.
const CHAPTER_REGEX = /^第(\d+)章[\s\S]*?\(本章完\)$/gm;

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
        .normalize("NFKC")
        .replace(/[^\p{Script=Han}\p{P}\p{N}]/gu, "")
        .replace(/\s+/g, "")
        .trim();
}

function ahoCorasickFindAll(
    validCleanTerms: string[],
    cleanToOriginalMap: Map<string, string>,
    text: string,
): MatchResult[] {
    const cleanText = preprocessChineseText(text);

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
                    end: endIndex,
                });
            }
        }
    }
    return foundMatches;
}

function chineseFuzzySearch(
    terms: string[],
    originalToCleanMap: Map<string, string>,
    text: string,
    jieba: Jieba,
    threshold: number = 85,
): Set<string> {
    const foundTerms = new Set<string>();
    const cleanText = preprocessChineseText(text);

    const textWords = jieba.cut(cleanText, true); // HMM mode
    const uniqueTextWords = new Set(textWords);

    for (const originalTerm of terms) {
        const term = originalToCleanMap.get(originalTerm);
        if (!term || term.length === 0) continue;

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

function chineseNGramSearch(
    terms: string[],
    originalToCleanMap: Map<string, string>,
    text: string,
): Set<string> {
    const foundTerms = new Set<string>();
    const cleanText = preprocessChineseText(text);

    for (const originalTerm of terms) {
        const cleanTerm = originalToCleanMap.get(originalTerm);
        if (!cleanTerm || cleanTerm.length === 0) continue;

        if (cleanText.includes(cleanTerm)) {
            foundTerms.add(originalTerm);
            continue;
        }

        const termChars = [...cleanTerm];
        if (termChars.length <= NGRAM_SEARCH_MAX_LENGTH) {
            try {
                const escapedTermChars = termChars.map((char) =>
                    char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                );

                const subsequenceRegex = new RegExp(escapedTermChars.join(".*?"), "u"); // Using .*? for non-greedy match

                if (subsequenceRegex.test(cleanText)) {
                    foundTerms.add(originalTerm);
                }
            } catch (e) {
                console.warn(
                    `⚠️ Could not create subsequence regex for term: ${originalTerm}`,
                    e,
                );
            }
        }
    }
    return foundTerms;
}

function openInVSCode(filePaths: string[]): Promise<void> {
    return new Promise((resolve) => {
        if (filePaths.length === 0) {
            resolve();
            return;
        }

        execFile("code", filePaths, { shell: true }, (error, _stdout, _stderr) => {
            if (error) {
                console.warn(
                    `\n⚠️  Could not open files in VS Code. Is the 'code' command in your system's PATH?`,
                );
                resolve();
                return;
            }
            console.log(
                `✅ Attempting to open ${filePaths.length} new chapter file(s) in VS Code...`,
            );
            resolve();
        });
    });
}

function getLastChapterNumber(translationFolderPath: string): number {
    console.log("\nVerifying last translated chapter number...");
    const files = readdirSync(translationFolderPath);
    const chapterNumbers = files
        .map((file) => (file.endsWith(".md") ? parseInt(file, 10) : NaN))
        .filter((num) => !isNaN(num));

    const lastChapterNumber =
        chapterNumbers.length > 0 ? Math.max(...chapterNumbers) : 0;

    console.log(`Last translated chapter was: ${lastChapterNumber}.`);
    return lastChapterNumber;
}

async function processAndCopy(
    assetsPath: string,
    translationsPath: string,
): Promise<void> {
    console.log("\n\nLoading Chinese segmenter dictionary...");
    const jieba = Jieba.withDict(dict);
    console.log("Dictionary loaded.");

    const glossaryData = readFileSync(
        path.resolve(assetsPath, GLOSSARY_FILE),
        "utf-8",
    );
    const glossaryList: GlossaryEntry[] = JSON.parse(glossaryData);

    const glossaryMap: Record<string, GlossaryEntry> = {};
    const originalToCleanMap = new Map<string, string>();
    const cleanToOriginalMap = new Map<string, string>();

    console.log("Preprocessing glossary terms...");
    for (const entry of glossaryList) {
        if (entry.cn) {
            const originalTerm = entry.cn;
            glossaryMap[originalTerm] = entry;

            const cleanTerm = preprocessChineseText(originalTerm);
            if (cleanTerm.length > 0) {
                originalToCleanMap.set(originalTerm, cleanTerm);
                cleanToOriginalMap.set(cleanTerm, originalTerm);
            }
        }
    }

    const allGlossaryTerms = Object.keys(glossaryMap);
    const validCleanTerms = Array.from(cleanToOriginalMap.keys());

    console.log(
        `Loaded ${allGlossaryTerms.length} main glossary entries. ${validCleanTerms.length} are valid for searching.`,
    );

    const originalChapterText = readFileSync(
        path.resolve(assetsPath, CHAPTER_FILE),
        "utf-8",
    );
    console.log("Loaded chapter file.");

    console.log(`\nScanning for chapters in ${CHAPTER_FILE}...`);
    const chapterMatches = [...originalChapterText.matchAll(CHAPTER_REGEX)];

    if (chapterMatches.length === 0) {
        throw new Error(
            `No chapters found in ${CHAPTER_FILE}. A chapter must start with '第...章' and end with '(本章完)' on its own line.`,
        );
    }

    console.log(`Found ${chapterMatches.length} chapter(s).`);

    const lastChapterNumber = getLastChapterNumber(translationsPath);
    let expectedChapterNumber = lastChapterNumber + 1;

    const createdFilePaths: string[] = [];
    const allCorrectedChapterTexts: string[] = [];

    for (const match of chapterMatches) {
        const originalChapterTextFragment = match[0];
        const actualChapterNumber = parseInt(match[1]!, 10); // Use ! assertion

        if (isNaN(actualChapterNumber)) {
            console.warn(`⚠️  Could not parse chapter number from match. Skipping...`);
            continue;
        }

        let chapterTextFragment = originalChapterTextFragment;
        let currentChapterNumber: number;

        console.log(`\nProcessing found chapter ${actualChapterNumber}...`);
        console.log(`Expected next chapter is: ${expectedChapterNumber}.`);

        if (actualChapterNumber !== expectedChapterNumber) {
            console.warn(
                `⚠️  Chapter number mismatch. Found ${actualChapterNumber}, expected ${expectedChapterNumber}.`,
            );
            const originalTitle = `第${actualChapterNumber}章`;
            const correctedTitle = `第${expectedChapterNumber}章`;

            chapterTextFragment = originalChapterTextFragment.replace(
                originalTitle,
                correctedTitle,
            );
            console.log("✅ Chapter number corrected in text.");
            currentChapterNumber = expectedChapterNumber;
        } else {
            console.log("✅ Chapter number is correct.");
            currentChapterNumber = actualChapterNumber;
        }

        allCorrectedChapterTexts.push(chapterTextFragment);

        const newFilePath = path.join(
            translationsPath,
            `${currentChapterNumber}.md`,
        );

        if (existsSync(newFilePath)) {
            console.warn(
                `⚠️  Warning: File '${path.basename(
                    newFilePath,
                )}' already exists. Skipping creation.`,
            );
        } else {
            writeFileSync(newFilePath, ""); // Create empty file
            console.log(
                `✅ Created empty file for new chapter: ${path.basename(newFilePath)}`,
            );
        }
        createdFilePaths.push(newFilePath);

        expectedChapterNumber++;
    }

    if (allCorrectedChapterTexts.length === 0) {
        console.log("\nNo new chapters were processed. Exiting.");
        return;
    }

    const combinedChapterText = allCorrectedChapterTexts.join("\n\n---\n\n");

    console.log("\n--- Starting Glossary Search (for all chapters) ---");
    console.time("Phase 1 (Chinese Exact)");
    const exactMatchesDetails = ahoCorasickFindAll(
        validCleanTerms,
        cleanToOriginalMap,
        combinedChapterText,
    );
    const foundExactInText = new Set(
        exactMatchesDetails.map((match) => match.term),
    );
    console.timeEnd("Phase 1 (Chinese Exact)");
    console.log(
        `Phase 1 (Chinese Exact): Found ${foundExactInText.size} unique exact terms.`,
    );

    const termsForFuzzy = allGlossaryTerms.filter(
        (term) => !foundExactInText.has(term),
    );
    console.time("Phase 2 (Chinese Fuzzy)");
    const foundFuzzyInText = chineseFuzzySearch(
        termsForFuzzy,
        originalToCleanMap,
        combinedChapterText,
        jieba,
        FUZZY_SEARCH_THRESHOLD,
    );
    console.timeEnd("Phase 2 (Chinese Fuzzy)");
    console.log(
        `Phase 2 (Chinese Fuzzy): Found ${foundFuzzyInText.size} fuzzy matched terms.`,
    );

    const termsForNGram = termsForFuzzy.filter(
        (term) => !foundFuzzyInText.has(term),
    );
    console.time("Phase 3 (Chinese N-gram/Subsequence)");
    const foundNGramInText = chineseNGramSearch(
        termsForNGram,
        originalToCleanMap,
        combinedChapterText,
    );
    console.timeEnd("Phase 3 (Chinese N-gram/Subsequence)");
    console.log(
        `Phase 3 (Chinese N-gram/Subsequence): Found ${foundNGramInText.size} n-gram matched terms.`,
    );

    const allFoundTerms = new Set([
        ...foundExactInText,
        ...foundFuzzyInText,
        // TODO: Fix this
        // ...foundNGramInText,
    ]);
    console.log(
        `\nTotal unique glossary terms after all phases: ${allFoundTerms.size}`,
    );

    const foundEntriesList = Array.from(allFoundTerms)
        .sort((a, b) => {
            const aLen = [...(originalToCleanMap.get(a) || "")].length;
            const bLen = [...(originalToCleanMap.get(b) || "")].length;
            return bLen - aLen || a.localeCompare(b); // Sort by processed length, desc
        })
        .map((term) => glossaryMap[term]);

    console.log("\n--- Final Micro-Glossary Terms ---");
    for (const entry of foundEntriesList) {
        if (!entry) continue;
        const cn = entry.cn || "???";
        const en = entry.en || "???";
        console.log(`* ${cn} - ${en}`);
    }

    const microGlossaryString = foundEntriesList
        .map((entry) => {
            if (!entry) return "";
            const cn = entry.cn || "???";
            const pinyin = entry.pinyin || "???";
            const en = entry.en || "???";

            const details: string[] = [];
            if (entry.type) details.push(entry.type);
            if (entry.gender) details.push(entry.gender);
            const detailsString =
                details.length > 0 ? ` [${details.join(", ")}]` : "";

            return `* ${cn} (${pinyin}) -> ${en}${detailsString}`;
        })
        .filter((line) => line)
        .join("\n");

    const promptTemplate = readFileSync(
        path.resolve(assetsPath, PROMPT_FILE),
        "utf-8",
    );

    const finalPromptString =
        `${promptTemplate}\n\n` +
        `**Glossary:**\n` +
        `${microGlossaryString}\n\n` +
        `---\n\n` +
        `**Chinese Chapter(s) to Translate:**\n` +
        `${combinedChapterText}`;

    await clipboardy.write(finalPromptString);

    console.log("\n" + "=".repeat(50));
    console.log(
        `✅ SUCCESS! The prompt for ${allCorrectedChapterTexts.length} chapter(s) has been copied to clipboard.`,
    );
    console.log(`Total glossary entries: ${foundEntriesList.length}`);
    console.log(`Created/Verified ${createdFilePaths.length} file(s):`);
    createdFilePaths.forEach((fp) => console.log(`  - ${path.basename(fp)}`));

    await openInVSCode(createdFilePaths);

    console.log("=".repeat(50));
}

async function main() {
    let argv;
    try {
        argv = await yargs(hideBin(process.argv))
            .option("assets-path", {
                type: "string",
                description: "The absolute path to the project assets directory",
                demandOption: true,
            })
            .option("translations-path", {
                type: "string",
                description:
                    "The absolute path to the project translations directory",
                demandOption: true,
            })
            .help()
            .parse();

        await processAndCopy(argv.assetsPath, argv.translationsPath);
    } catch (error: any) {
        if (error.code === "ENOENT") {
            console.error("\n--- ❌ ERROR: FILE NOT FOUND ---");
            console.error(
                `Please ensure the file '${error.path}' exists and try again.`,
            );
        } else {
            console.error(`\n--- ❌ AN UNEXPECTED ERROR OCCURRED ---`);
            console.error(error.message);
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();