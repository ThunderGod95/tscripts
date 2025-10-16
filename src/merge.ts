import * as fs from 'fs';
import * as path from 'path';
import type { GlossaryEntry } from "./types";

const GLOSSARY_FILE_PATH = "C:\\Users\\tarun\\Translations\\TheMirrorLegacy\\assets\\glossary.json";

function cleanGlossary() {
    console.log(`Loading glossary from: ${GLOSSARY_FILE_PATH}`);

    let glossaryData: GlossaryEntry[];
    let fileContent: string;

    try {
        fileContent = fs.readFileSync(GLOSSARY_FILE_PATH, 'utf-8');
        glossaryData = JSON.parse(fileContent);
    } catch (error: any) {
        console.error(`Error reading file: ${error.message}`);
        console.error("Script aborted. No files were changed.");
        return;
    }

    try {
        const dir = path.dirname(GLOSSARY_FILE_PATH);
        const ext = path.extname(GLOSSARY_FILE_PATH);
        const base = path.basename(GLOSSARY_FILE_PATH, ext);
        const backupPath = path.join(dir, `${base}.bak${ext}`);

        console.log(`Creating backup at: ${backupPath}`);
        fs.writeFileSync(backupPath, fileContent, 'utf-8');
        console.log("Backup created successfully. ✅");
    } catch (error: any) {
        console.error(`FATAL: Error creating backup: ${error.message}`);
        console.error("Script aborted to prevent data loss. No files were changed.");
        return;
    }

    const originalCount = glossaryData.length;

    const seenCnMap = new Map<string, string>();
    const conflicts = new Map<string, Set<string>>();
    const cleanedData: GlossaryEntry[] = [];
    let exactDuplicatesRemoved = 0;

    for (const entry of glossaryData) {
        const { cn, en } = entry;
        const firstEnSeen = seenCnMap.get(cn);

        if (!firstEnSeen) {
            seenCnMap.set(cn, en);
            cleanedData.push(entry);
        } else {
            if (firstEnSeen === en) {
                exactDuplicatesRemoved++;
            } else {
                cleanedData.push(entry);
                let conflictSet = conflicts.get(cn);
                if (!conflictSet) {
                    conflictSet = new Set<string>([firstEnSeen]);
                    conflicts.set(cn, conflictSet);
                }
                conflictSet.add(en);
            }
        }
    }

    console.log("\n--- CONFLICTS FOUND (Same CN, Different EN) ---");
    if (conflicts.size === 0) {
        console.log("No conflicts found. 👍");
    } else {
        conflicts.forEach((enSet, cn) => {
            console.warn(`WARNING: "${cn}" has multiple EN values: [${[...enSet].join(', ')}]`);
        });
        console.warn(`\nTotal 'cn' keys with conflicts: ${conflicts.size}`);
        console.log("These conflicting entries were *kept* in the file.");
    }
    console.log("-------------------------------------------------");

    console.log("\n--- FILE MODIFICATION ---");
    if (exactDuplicatesRemoved > 0) {
        try {
            const jsonData = JSON.stringify(cleanedData, null, 2);
            fs.writeFileSync(GLOSSARY_FILE_PATH, jsonData, 'utf-8');

            console.log(`Successfully modified ${path.basename(GLOSSARY_FILE_PATH)}. 📝`);
            console.log(`Original entries: ${originalCount}`);
            console.log(`Exact duplicates removed: ${exactDuplicatesRemoved}`);
            console.log(`New total entries: ${cleanedData.length}`);
        } catch (error: any) {
            console.error(`Error writing modified file: ${error.message}`);
            console.error("Your original file is safe, and the backup is available.");
        }
    } else {
        console.log("No exact duplicates found. Original file was not modified.");
    }
}

cleanGlossary();