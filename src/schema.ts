import fs from "fs";
import path from "path";
import { findFirstWordInstance } from "./finder";

const glossaryPath = "C:/Users/tarun/CodingProjects/nt/translations/TheMirrorLegacy/Assets/glossary.json";
const markdownFolderPath = "C:/Users/tarun/CodingProjects/nt/translations/TheMirrorLegacy";
const outputPath = "C:/Users/tarun/CodingProjects/nt/translations/TheMirrorLegacy/Assets/glossary-updated.json";

// console.log("Loading glossary...");
// const glossaryData = JSON.parse(fs.readFileSync(glossaryPath, "utf-8"));
// console.log(`Glossary entries loaded: ${glossaryData.length}`);

// console.log("Reading markdown files into memory...");
// const mdFiles = fs.readdirSync(markdownFolderPath).filter(f => f.endsWith(".md"));

// const fileContentsByNumber = new Map<number, string>();
// mdFiles.forEach(file => {
//     const baseName = path.basename(file, ".md");
//     const fileNumber = parseInt(baseName, 10);
//     if (!isNaN(fileNumber)) {
//         const content = fs.readFileSync(path.join(markdownFolderPath, file), "utf-8").toLowerCase();
//         fileContentsByNumber.set(fileNumber, content);
//     } else {
//         console.log(`Skipping non-numeric file: ${file}`);
//     }
// });
// console.log(`Loaded ${fileContentsByNumber.size} markdown files into memory.`);

// function findFileForPhrase(phrase: string): number | null {
//     const phraseLower = phrase.toLowerCase();
//     for (const [fileNum, content] of fileContentsByNumber.entries()) {
//         if (content.includes(phraseLower)) {
//             return fileNum;
//         }
//     }
//     return null;
// }

// console.log("Updating glossary with file numbers based on phrase search...");

// let missingCount = 0;
// const updatedGlossary = glossaryData.map((entry, idx) => {
//     const phrase = entry.en || "";
//     const fileNum = findFileForPhrase(phrase);
//     if (fileNum === null) missingCount++;

//     if ((idx + 1) % 100 === 0 || idx === glossaryData.length - 1) {
//         console.log(`Processed ${idx + 1} / ${glossaryData.length} glossary entries`);
//     }
//     return { ...entry, file: fileNum };
// });

// console.log(`Update complete. Entries with no matching file: ${missingCount}`);
// console.log(`Saving updated glossary to ${outputPath}...`);

// fs.writeFileSync(outputPath, JSON.stringify(updatedGlossary, null, 4), "utf-8");

// console.log("Updated glossary saved.");

console.log("Loading glossary...");

const glossaryData = JSON.parse(fs.readFileSync(glossaryPath, "utf-8"));

console.log(`Glossary entries loaded: ${glossaryData.length}`);

const fileContentsByNumber = new Map<number, string>();

console.log("Reading markdown files into memory...");

const mdFiles = fs.readdirSync(markdownFolderPath).filter(f => f.endsWith(".md"));

mdFiles.forEach(file => {
    const baseName = path.basename(file, ".md");
    const fileNumber = parseInt(baseName, 10);

    if (!isNaN(fileNumber)) {
        const content = fs.readFileSync(path.join(markdownFolderPath, file), "utf-8").toLowerCase();
        fileContentsByNumber.set(fileNumber, content);
    } else {
        console.log(`Skipping non-numeric file: ${file}`);
    }
});

console.log(`Loaded ${fileContentsByNumber.size} markdown files into memory.`);

let missingCount = 0;

glossaryData.map((entry: any, idx: number) => {
    const phrase = entry.en || "";
    const fileNum = findFirstWordInstance(fileContentsByNumber, phrase, false);

    if (fileNum === null) {
        missingCount++;
        console.log(`No matching file found for phrase: "${phrase}"`);
    }

    entry.file = fileNum;
});

console.log(`Update complete. Entries with no matching file: ${missingCount}`);
console.log(`Saving updated glossary to ${outputPath}...`);

fs.writeFileSync(outputPath, JSON.stringify(glossaryData, null, 4), "utf-8");

console.log("Updated glossary saved.");


