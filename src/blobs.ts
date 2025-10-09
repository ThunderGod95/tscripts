import * as fs from 'fs';
import * as path from 'path';

const SOURCE_DIRECTORY = 'C:/Users/tarun/Translations/TheMirrorLegacy/translations';
const DESTINATION_DIRECTORY = 'C:/Users/tarun/Translations/TheMirrorLegacy/translations/merged';
const FILES_PER_CHUNK = 50;

async function mergeFilesSequentially() {
    try {
        fs.mkdirSync(DESTINATION_DIRECTORY, { recursive: true });
    } catch (error) {
        console.error(`❌ Error creating directory: ${(error as Error).message}`);
        return;
    }

    // 1. Get a list of all .md files in the source directory.
    let filesToMerge: string[];
    try {
        filesToMerge = fs.readdirSync(SOURCE_DIRECTORY).filter(file =>
            file.toLowerCase().endsWith('.md') &&
            fs.statSync(path.join(SOURCE_DIRECTORY, file)).isFile()
        );
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.error(`❌ Error: The source folder '${SOURCE_DIRECTORY}' was not found.`);
        } else {
            console.error(`❌ Error reading source directory: ${(error as Error).message}`);
        }
        return;
    }

    if (filesToMerge.length === 0) {
        console.log(`ℹ️ No .md files found in '${SOURCE_DIRECTORY}'.`);
        return;
    }

    // 2. Sort the files numerically. This is the key change.
    console.log("Sorting files numerically...");
    filesToMerge.sort((a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        return numA - numB;
    });

    console.log(`Found and sorted ${filesToMerge.length} files to merge.`);

    // 3. Process the sorted files in chunks.
    let mergedCount = 0;
    for (let i = 0; i < filesToMerge.length; i += FILES_PER_CHUNK) {
        const chunkFiles = filesToMerge.slice(i, i + FILES_PER_CHUNK);

        const mergedFileNumber = Math.floor(i / FILES_PER_CHUNK) + 1;
        const mergedFileName = `merged_file_${mergedFileNumber}.md`; // Output as .md
        const mergedFilePath = path.join(DESTINATION_DIRECTORY, mergedFileName);

        console.log(`\nProcessing chunk ${mergedFileNumber}: Creating '${mergedFileName}'...`);

        const writer = Bun.file(mergedFilePath).writer();
        for (const filename of chunkFiles) {
            const sourceFilePath = path.join(SOURCE_DIRECTORY, filename);
            const fileContent = await Bun.file(sourceFilePath).text();

            writer.write(fileContent);
            writer.write(`\n\n\n\n`);
            mergedCount++;
        }
        await writer.end();
    }

    console.log(`\n🎉 Success! Merged a total of ${mergedCount} files into the '${DESTINATION_DIRECTORY}' directory.`);
}


mergeFilesSequentially();