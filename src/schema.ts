import fs, { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";
import { findFirstFileWithMatch } from "./finder";
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import type { GlossaryEntry } from "./types";

function updateGlossary(glossaryPath: string, markdownFolderPath: string, outputPath: string) {
    if (!existsSync(glossaryPath) || !existsSync(markdownFolderPath) || !statSync(markdownFolderPath).isDirectory()) {
        console.error("Error: One or more provided paths are invalid.");
        console.error(`Glossary: ${glossaryPath}`);
        console.error(`Markdown Folder: ${markdownFolderPath}`);
        return;
    }

    console.log("Loading glossary...");
    const glossaryData = JSON.parse(readFileSync(glossaryPath, "utf-8"));
    console.log(`Glossary entries loaded: ${glossaryData.length}`);

    const fileContentsByNumber = new Map<number, string>();
    console.log("Reading markdown files into memory...");
    const mdFiles = fs.readdirSync(markdownFolderPath).filter(f => f.endsWith(".md"));

    mdFiles.sort((a, b) => {
        const numA = parseInt(path.basename(a, '.md'), 10);
        const numB = parseInt(path.basename(b, '.md'), 10);
        return numA - numB;
    });

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

    glossaryData.forEach((entry: GlossaryEntry) => {
        const phrase = entry.en || "";
        const fileNum = findFirstFileWithMatch(fileContentsByNumber, phrase, false);

        if (fileNum === null) {
            missingCount++;
            console.log(`No matching file found for phrase: "${phrase}"`);
        }
        entry.file = fileNum;
    });

    console.log(`Update complete. Entries with no matching file: ${missingCount}`);

    console.log("Sorting glossary entries by file number (nulls first)...");
    glossaryData.sort((a: any, b: any) => {
        if (a.file === null && b.file === null) return 0;
        if (a.file === null) return -1;
        if (b.file === null) return 1;

        return a.file - b.file;
    });

    console.log(`Saving updated glossary to ${outputPath}...`);
    writeFileSync(outputPath, JSON.stringify(glossaryData, null, 4), "utf-8");
    console.log("Updated glossary saved.");
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('glossary-path', {
            type: 'string',
            description: 'Path to the source glossary.json file',
            demandOption: true
        })
        .option('markdown-folder', {
            type: 'string',
            description: 'Path to the folder containing markdown translation files',
            demandOption: true
        })
        .option('output-path', {
            type: 'string',
            description: 'Path to write the updated glossary file',
            demandOption: true
        })
        .help()
        .parse();

    updateGlossary(argv.glossaryPath, argv.markdownFolder, argv.outputPath);
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});