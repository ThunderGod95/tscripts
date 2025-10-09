import { command, run, positional, option, flag, string } from "cmd-ts";
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, extname, basename } from "path";

export type Result = [string, number, string];

export function findFirstWordInstanceInFolder(folderPath: string, searchPattern: string, useRegex = false): number | null {
    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
        throw new Error(`The folder path '${folderPath}' does not exist or is not a directory.`);
    }

    const files = readdirSync(folderPath).filter(f => extname(f) === ".md");

    files.sort((a, b) => {
        const aNum = parseInt(basename(a, ".md"));
        const bNum = parseInt(basename(b, ".md"));
        if (isNaN(aNum) || isNaN(bNum)) return a.localeCompare(b);
        return aNum - bNum;
    });

    const mdFileContents = new Map<number, string>();

    for (const file of files) {
        const filePath = join(folderPath, file);

        try {
            const content = readFileSync(filePath, { encoding: "utf-8" });
            mdFileContents.set(parseInt(basename(filePath, ".md")), content);
        } catch (e) {
            console.error(`Error: Failed to read ${filePath}: ${(e as Error).message}`);
            continue;
        }
    }

    return findFirstWordInstance(mdFileContents, searchPattern, useRegex);
}

export function findFirstWordInstance(content: Map<number, string>, searchPattern: string, useRegex = false): number | null {
    let regex: RegExp | null = null;

    if (useRegex) {
        regex = new RegExp(searchPattern, "i");
    }

    for (const [fileNum, fileContent] of content.entries()) {
        const lines = (fileContent ?? "").split(/\r?\n/);
        for (const line of lines) {
            if (useRegex && regex) {
                if (regex.test(line ?? "")) {
                    return fileNum;
                }
            } else {
                if (line?.toLowerCase().includes(searchPattern.toLowerCase())) {
                    return fileNum;
                }
            }
        }
    }

    return null;
}

export function findWordAllInstances(folderPath: string, searchPattern: string, useRegex = false): { results: Result[]; filesScanned: number; totalMatches: number } {
    const results: Result[] = [];
    let filesScanned = 0;
    let totalMatches = 0;
    let regex: RegExp | null = null;

    if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
        throw new Error(`The folder path '${folderPath}' does not exist or is not a directory.`);
    }

    if (useRegex) {
        regex = new RegExp(searchPattern, "i");
    }

    const files = readdirSync(folderPath).filter(f => extname(f) === ".md");
    files.sort((a, b) => {
        const aNum = parseInt(basename(a, ".md"));
        const bNum = parseInt(basename(b, ".md"));
        if (isNaN(aNum) || isNaN(bNum)) return a.localeCompare(b);
        return aNum - bNum;
    });

    for (const fname of files) {
        const filePath = join(folderPath, fname);
        filesScanned++;
        try {
            const content = readFileSync(filePath, { encoding: "utf-8" });
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineNum = i + 1;
                if (useRegex && regex) {
                    if (regex.test(line ?? "")) {
                        results.push([fname, lineNum, (line ?? "").trimEnd()]);
                        totalMatches++;
                    }
                } else {
                    if (line?.toLowerCase().includes(searchPattern.toLowerCase())) {
                        results.push([fname, lineNum, line.trimEnd()]);
                        totalMatches++;
                    }
                }
            }
        } catch (e) {
            console.error(`Error: Failed to read ${filePath}: ${(e as Error).message}`);
            continue;
        }
    }

    return { results, filesScanned, totalMatches };
}

function printTable(results: Result[]): void {
    if (results.length === 0) return;

    const fileColWidth = Math.max(...results.map(r => r[0].length), "File".length);
    const lineColWidth = Math.max(...results.map(r => r[1].toString().length), "Line".length);
    const textColWidth = Math.max(...results.map(r => r[2].length), "Text".length);

    const header = `${"File".padEnd(fileColWidth)} | ${"Line".padEnd(lineColWidth)} | ${"Text".padEnd(textColWidth)}`;
    console.log(header);
    console.log("-".repeat(header.length));

    for (const [fname, lineNum, lineContent] of results) {
        console.log(`${fname.padEnd(fileColWidth)} | ${lineNum.toString().padEnd(lineColWidth)} | ${lineContent.padEnd(textColWidth)}`);
    }
}

function writeParagraphsToFile(results: Result[], outputFile: string, folderPath: string): void {
    try {
        const resultsByFile = new Map<string, Result[]>();
        for (const result of results) {
            const fname = result[0]; // Filename
            if (!resultsByFile.has(fname)) {
                resultsByFile.set(fname, []);
            }
            resultsByFile.get(fname)!.push(result);
        }

        const outputLines: string[] = [];

        for (const [fname, fileResults] of resultsByFile.entries()) {
            const filePath = join(folderPath, fname);
            let firstLine = "";
            try {
                const content = readFileSync(filePath, { encoding: "utf-8" });
                firstLine = content.split(/\r?\n/)[0] ?? "";
            } catch (e) {
                console.error(`Error: Failed to read ${filePath} to get first line: ${(e as Error).message}`);
                firstLine = `[Error reading first line of ${fname}]`;
            }
            outputLines.push(firstLine);

            for (const result of fileResults) {
                const lineNum = result[1];
                const lineContent = result[2];
                outputLines.push(`[${lineNum}] ${lineContent}\n`);
            }
        }

        writeFileSync(outputFile, outputLines.join("\n"), { encoding: "utf-8" });

    } catch (e) {
        console.error(`Error: Failed to write to ${outputFile}: ${(e as Error).message}`);
    }
}

const cli = command({
    name: "bun finder.ts",
    description: "Find all instances of a word or regex pattern in Markdown files",
    args: {
        searchPattern: positional({ type: string, displayName: "searchPattern", description: "Search word or regex pattern" }),
        folder: option({ type: string, long: "folder", short: "f", defaultValue: () => String.raw`C:\Users\tarun\CodingProjects\nt\translations\TheMirrorLegacy\translations`, description: "Folder to scan" }),
        regex: flag({ long: "regex", description: "Treat search pattern as regular expression" }),
        output: option({ type: string, long: "output", short: "o", defaultValue: () => "", description: "Output file to write paragraphs to (optional)" }),
        quiet: flag({ long: "quiet", short: "q", description: "Suppress table output, only show summary" }),
    },
    handler: ({ searchPattern, folder, regex, output, quiet }) => {
        try {
            const start = Date.now();
            const { results, filesScanned, totalMatches } = findWordAllInstances(folder, searchPattern, regex);
            const elapsed = (Date.now() - start) / 1000;

            if (results.length > 0) {
                if (!quiet) {
                    console.log(`\nResults for pattern '${searchPattern}':\n`);
                    printTable(results);
                }
                if (output != "") {
                    writeParagraphsToFile(results, output, folder);
                }
            } else {
                console.log(`The pattern '${searchPattern}' was not found in any file.`);
            }

            console.log(`\nFiles scanned: ${filesScanned}`);
            console.log(`Total matches: ${totalMatches}`);
            console.log(`Elapsed Time: ${elapsed.toFixed(2)} seconds`);
            if (output && results.length > 0) {
                console.log(`Output written to: ${output}`);
            }
            console.log("Error messages (if any) were printed to console.");
        } catch (e) {
            console.error(`Fatal error: ${(e as Error).message}`);
            process.exit(1);
        }
    }
});

if (import.meta.main) {
    run(cli, process.argv.slice(2));
}