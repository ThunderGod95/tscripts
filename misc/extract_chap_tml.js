function extractContentRaw() {
    const allContentBoxes = document.querySelectorAll("div.contentbox:has(i)");

    let targetBox = null;

    for (const box of allContentBoxes) {
        if (window.getComputedStyle(box).display !== "none") {
            targetBox = box;
            break;
        }
    }

    if (!targetBox) {
        return;
    }

    const results = [];

    function processNode(node) {
        node.childNodes.forEach((child) => {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName;

                if (tagName === "I") {
                    const tValue = child.getAttribute("t");
                    if (tValue) {
                        results.push(tValue.trim());
                    }
                } else if (tagName === "BR") {
                    results.push("\n");
                } else {
                    processNode(child);
                }
            } else if (child.nodeType === Node.TEXT_NODE) {
                const content = child.textContent;
                if (content !== "" && content !== " ") {
                    results.push(content);
                }
            }
        });
    }

    processNode(targetBox);

    console.log(results.join(""));
}
