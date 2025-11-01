import { join } from "path";
import { existsSync } from "fs";

function check() {
    const path = "C:\\Users\\tarun\\Translations\\TheMirrorLegacy\\translations";

    let all_found = true;

    for (let i = 655; i <= 1294; i++) {
        const filePath = join(path, `${i}.md`);
        if (!existsSync(filePath)) {
            console.log(`Chapter ${i} not found.`);
            all_found = false;
        }
    }

    if (all_found) {
        console.log("All found.");
    }
}

check();