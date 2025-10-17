import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import AdmZip from 'adm-zip';
import { mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('translations-dir', {
            type: 'string',
            description: 'Path to the translations directory',
            demandOption: true,
        })
        .option('assets-dir', {
            type: 'string',
            description: 'Path to the assets directory',
            demandOption: true,
        })
        .option('dist-dir', {
            type: 'string',
            description: 'Path to the output distribution directory',
            demandOption: true,
        })
        .help()
        .alias('help', 'h')
        .parse();

    const { translationsDir, assetsDir, distDir } = argv;

    try {
        console.log(`\nStarting build...\n`);

        if (!existsSync(translationsDir) || !existsSync(assetsDir)) {
            throw new Error(`Required directories 'translations' or 'assets' do not exist.`);
        }

        if (!existsSync(distDir)) {
            await mkdir(distDir, { recursive: true });
        }

        createZipArchive(translationsDir, assetsDir, distDir);

        console.log(`Build completed successfully.`);
    } catch (error) {
        console.error(`❌ Build failed:`, error instanceof Error ? error.message : error || '');
    }
}

async function createZipArchive(translationsDir: string, assetsDir: string, distDir: string) {
    try {
        const zipPath = join(distDir, 'translations_archive.zip');
        const zip = new AdmZip();

        console.log(`Reading files in '${translationsDir}'...`);
        zip.addLocalFolder(translationsDir, 'translations');

        console.log(`Reading files in '${assetsDir}'...`);
        zip.addLocalFolder(assetsDir, 'assets');

        zip.writeZip(zipPath);
        console.log(`Zip archive created at '${zipPath}'.`);
    } catch (error) {
        throw new Error(`Failed to create zip archive: ${error instanceof Error ? error.message : error || ''}`);
    }
}

main();