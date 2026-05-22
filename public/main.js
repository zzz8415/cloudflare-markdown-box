const authView = document.getElementById("authView");
const appChrome = document.getElementById("appChrome");
const errorView = document.getElementById("errorView");
const listView = document.getElementById("listView");
const editView = document.getElementById("editView");
const shareDialog = document.getElementById("shareDialog");
const shareView = document.getElementById("shareView");

const authMsg = document.getElementById("authMsg");
const editMsg = document.getElementById("editMsg");
const userLabel = document.getElementById("userLabel");
const chromeNewDocBtn = document.getElementById("chromeNewDocBtn");
const chromeRefreshBtn = document.getElementById("chromeRefreshBtn");
const appTitle = document.getElementById("appTitle");

const loginUser = document.getElementById("loginUser");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const changePwdBtn = document.getElementById("changePwdBtn");

const docListEl = document.getElementById("docList");

const editHeaderTitle = document.getElementById("editHeaderTitle");
const editMeta = document.getElementById("editMeta");
const docTitle = document.getElementById("docTitle");
const editorToolbar = document.getElementById("editorToolbar");
const saveBtn = document.getElementById("saveBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editorHost = document.getElementById("editor");

const publicTitle = document.getElementById("publicTitle");
const publicDate = document.getElementById("publicDate");
const publicContent = document.getElementById("publicContent");
const shareLinkInput = document.getElementById("shareLinkInput");
const shareRefreshBtn = document.getElementById("shareRefreshBtn");
const shareCopyBtn = document.getElementById("shareCopyBtn");
const shareOpenBtn = document.getElementById("shareOpenBtn");
const shareCloseBtn = document.getElementById("shareCloseBtn");

const errorEyebrow = document.getElementById("errorEyebrow");
const errorTitle = document.getElementById("errorTitle");
const errorDescription = document.getElementById("errorDescription");
const errorActions = document.getElementById("errorActions");
const errorRetryBtn = document.getElementById("errorRetryBtn");
const errorBackBtn = document.getElementById("errorBackBtn");

const dialogMask = document.getElementById("dialogMask");
const dialogTitle = document.getElementById("dialogTitle");
const dialogMessage = document.getElementById("dialogMessage");
const dialogInputWrap = document.getElementById("dialogInputWrap");
const dialogInput = document.getElementById("dialogInput");
const dialogFormWrap = document.getElementById("dialogFormWrap");
const dialogCancelBtn = document.getElementById("dialogCancelBtn");
const dialogConfirmBtn = document.getElementById("dialogConfirmBtn");

let docs = [];
let currentDoc = null;
let editor = null;
let editorLoading = null;
let editorFallback = null;
let pendingRetry = null;
let currentUsername = "";
let activeShareUrl = "";
let activeShareDocId = "";
let lastEditorSelection = null;

const TINYMDE_SCRIPT_URL = "/vendor/tinymde.js";
const TINYMDE_MOUNT_SELECTOR = '[data-editor-mount="tinymde"]';

const toast = document.createElement("div");
toast.className = "toast";
document.body.appendChild(toast);

let toastTimer = null;

const notify = (message, type = "info") => {
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
};

const setBusy = (busy) => {
    document.body.dataset.busy = busy ? "true" : "false";
};

const withBusy = async (button, task, pendingLabel = "处理中...") => {
    if (button) {
        button.disabled = true;
        button.dataset.originalText = button.textContent;
        button.textContent = pendingLabel;
    }

    setBusy(true);
    try {
        return await task();
    } finally {
        setBusy(false);
        if (button) {
            button.disabled = false;
            button.textContent = button.dataset.originalText || button.textContent;
            delete button.dataset.originalText;
        }
    }
};

const api = async (path, options = {}) => {
    const response = await fetch(path, {
        credentials: "include",
        headers: { "content-type": "application/json" },
        ...options
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || "请求失败");
    }
    return data;
};

const copyText = async (text) => {
    if (!text) return false;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // fall through to selection copy
        }
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "true");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    helper.style.pointerEvents = "none";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, helper.value.length);

    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }

    document.body.removeChild(helper);
    return copied;
};

const closeShareDialog = () => {
    activeShareUrl = "";
    activeShareDocId = "";
    shareLinkInput.value = "";
    shareOpenBtn.setAttribute("href", "#");
    shareDialog.classList.add("hidden");
};

const showShareDialog = (shareUrl, docId = "") => {
    const target = getShareLinkTarget(shareUrl);
    activeShareUrl = target.href;
    activeShareDocId = docId;
    shareLinkInput.value = target.href;
    shareOpenBtn.setAttribute("href", target.href);
    shareDialog.classList.remove("hidden");
    requestAnimationFrame(() => {
        shareLinkInput.focus();
        shareLinkInput.select();
    });
};

const getShareLinkTarget = (shareUrl) => {
    try {
        const url = new URL(shareUrl, window.location.href);
        return { href: url.toString() };
    } catch {
        return { href: shareUrl };
    }
};

const openPendingWindow = (title, message) => {
    const pendingWindow = window.open("about:blank", "_blank");

    if (pendingWindow && pendingWindow.document) {
        pendingWindow.document.title = title;
        pendingWindow.document.body.innerHTML = `<p style="margin:40px auto;max-width:480px;font:16px/1.6 sans-serif;color:#1f1d1a;text-align:center;">${message}</p>`;
    }

    return pendingWindow;
};

const openEditWindow = (id) => {
    const editUrl = new URL(`/docs/${id}/edit`, window.location.origin).toString();
    const opened = window.open(editUrl, "_blank");
    if (!opened) {
        throw new Error("浏览器阻止了编辑窗口，请允许弹出窗口后重试");
    }
    return opened;
};

const notifyDocsChanged = () => {
    if (!window.opener || window.opener.closed) return;
    window.opener.postMessage({ type: "docs:refresh" }, window.location.origin);
};

const formatLocalDateTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
};

const renderMarkdown = (source) => {
    const raw = source || "";
    const html = marked.parse(raw, {
        breaks: true,
        gfm: true
    });
    return DOMPurify.sanitize(html);
};

const getEditorMinimumHeight = () => Math.max(520, Math.round(window.innerHeight * 0.62));

const getEditorMinimumContentHeight = () => Math.max(420, getEditorMinimumHeight() - 96);

const autoResizeEditorFallback = (allowShrink = false) => {
    if (!editorFallback) return;
    const minHeight = getEditorMinimumHeight();
    const desiredHeight = Math.max(minHeight, editorFallback.scrollHeight);
    const currentHeight = parseInt(editorFallback.style.height || "0", 10) || minHeight;
    editorFallback.style.minHeight = `${minHeight}px`;

    if (allowShrink || desiredHeight > currentHeight) {
        editorFallback.style.height = `${desiredHeight}px`;
    }
};

const getTinyMdeRoot = () => editorHost.querySelector("#tinymde-root");

const getTinyMdeEditorElement = () => editorHost.querySelector("#tinymde-editor");

const isMacPlatform = () => /MAC|IPHONE|IPAD|IPOD/.test(navigator.platform.toUpperCase());

const hasPrimaryModifier = (event) => (isMacPlatform() ? event.metaKey : event.ctrlKey);

const installTinyMdeMacShortcutBridge = () => {
    if (!isMacPlatform()) return;

    const editorElement = getTinyMdeEditorElement();
    if (!editorElement || editorElement.dataset.macShortcutBridge === "1") return;

    editorElement.dataset.macShortcutBridge = "1";
    editorElement.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (!event.metaKey || event.ctrlKey || event.altKey) return;

        const key = event.key.toLowerCase();

        // 允许系统原生剪贴板与全选行为，但阻止 TinyMDE 将其误处理为普通输入
        if (["a", "c", "v", "x"].includes(key)) {
            event.stopImmediatePropagation();
            return;
        }

        if (key === "s" && !editView.classList.contains("hidden")) {
            event.preventDefault();
            event.stopImmediatePropagation();
            withBusy(saveBtn, saveDoc, "保存中...").catch((err) => setEditMessage(err.message));
            return;
        }

        if (key === "n") {
            event.preventDefault();
            event.stopImmediatePropagation();
            withBusy(chromeNewDocBtn, createDoc, "创建中...").catch((err) => notify(err.message, "error"));
            return;
        }

        // TinyMDE 内部只识别 ctrl，这里把常见 Command 组合桥接为 ctrl 组合
        if (["z", "y", "b", "i", "k", "l", "0", "1", "2", "3", "4", "5", "6", "backspace"].includes(key)) {
            event.preventDefault();
            event.stopImmediatePropagation();

            const mappedKey = key === "y" ? "z" : key;
            const mappedShift = key === "y" ? true : event.shiftKey;

            editorElement.dispatchEvent(new KeyboardEvent("keydown", {
                key: mappedKey,
                ctrlKey: true,
                shiftKey: mappedShift,
                bubbles: true,
                cancelable: true
            }));
        }
    }, true);
};

const installTinyMdeDeleteKeyFix = () => {
    const editorElement = getTinyMdeEditorElement();
    if (!editorElement || editorElement.dataset.deleteKeyFix === "1") return;

    editorElement.dataset.deleteKeyFix = "1";
    editorElement.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key !== "Delete") return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        applyEditorTransform((state) => {
            const { content, start, end } = state;

            if (start !== end) {
                return {
                    content: `${content.slice(0, start)}${content.slice(end)}`,
                    start,
                    end: start
                };
            }

            if (start >= content.length) {
                return {
                    content,
                    start,
                    end: start
                };
            }

            return {
                content: `${content.slice(0, start)}${content.slice(start + 1)}`,
                start,
                end: start
            };
        }).catch((error) => {
            console.error(error);
            notify("Delete 操作失败", "error");
        });
    }, true);
};

const getTinyMdeParagraphs = () => Array.from(editorHost.querySelectorAll("#tinymde-editor .tinymde-paragraph"));

const getTinyParagraphText = (paragraph) => paragraph?.innerText || paragraph?.textContent || "";

const getClosestTinyParagraph = (node) => {
    let current = node;

    while (current) {
        if (current.nodeType === Node.ELEMENT_NODE && current.classList?.contains("tinymde-paragraph")) {
            return current;
        }
        current = current.parentNode;
    }

    return null;
};

const getTinyParagraphOffset = (paragraphs, paragraph, offsetInParagraph) => {
    let total = 0;

    for (const currentParagraph of paragraphs) {
        if (currentParagraph === paragraph) {
            return total + offsetInParagraph;
        }

        total += getTinyParagraphText(currentParagraph).length + 1;
    }

    return total;
};

const getTextOffsetWithinParagraph = (paragraph, container, offset) => {
    if (!paragraph) return 0;

    const range = document.createRange();
    range.selectNodeContents(paragraph);

    try {
        range.setEnd(container, offset);
    } catch {
        return getTinyParagraphText(paragraph).length;
    }

    return range.toString().length;
};

const getTinyMdeSelection = () => {
    const content = editor?.getContent() || "";
    const editorElement = getTinyMdeEditorElement();
    const paragraphs = getTinyMdeParagraphs();

    if (!editorElement || !paragraphs.length) {
        return { mode: "tinymde", content, start: content.length, end: content.length };
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorElement.contains(selection.anchorNode)) {
        return { mode: "tinymde", content, start: content.length, end: content.length };
    }

    const range = selection.getRangeAt(0);
    const startParagraph = getClosestTinyParagraph(range.startContainer) || paragraphs[0];
    const endParagraph = getClosestTinyParagraph(range.endContainer) || startParagraph;
    const startOffset = getTextOffsetWithinParagraph(startParagraph, range.startContainer, range.startOffset);
    const endOffset = getTextOffsetWithinParagraph(endParagraph, range.endContainer, range.endOffset);
    const start = getTinyParagraphOffset(paragraphs, startParagraph, startOffset);
    const end = getTinyParagraphOffset(paragraphs, endParagraph, endOffset);

    return {
        mode: "tinymde",
        content,
        start: Math.min(start, end),
        end: Math.max(start, end)
    };
};

const getTextareaSelection = () => {
    const content = editorFallback?.value || "";
    const start = editorFallback?.selectionStart ?? content.length;
    const end = editorFallback?.selectionEnd ?? start;

    return {
        mode: "textarea",
        content,
        start,
        end
    };
};

const cacheEditorSelection = () => {
    if (editor) {
        lastEditorSelection = getTinyMdeSelection();
        return;
    }

    if (editorFallback) {
        lastEditorSelection = getTextareaSelection();
    }
};

const getEditorSelectionState = () => {
    if (editor) {
        const state = getTinyMdeSelection();
        const selection = window.getSelection();
        const editorElement = getTinyMdeEditorElement();

        if (editorElement && selection && editorElement.contains(selection.anchorNode)) {
            lastEditorSelection = state;
            return state;
        }

        if (lastEditorSelection?.mode === "tinymde" && lastEditorSelection.content === state.content) {
            return lastEditorSelection;
        }

        return state;
    }

    if (editorFallback) {
        const state = getTextareaSelection();
        lastEditorSelection = state;
        return state;
    }

    return {
        mode: "plain",
        content: getEditorValue(),
        start: 0,
        end: 0
    };
};

const resolveTinySourceIndex = (sourceIndex) => {
    const paragraphs = getTinyMdeParagraphs();
    if (!paragraphs.length) return null;

    let remaining = Math.max(0, sourceIndex);

    for (let index = 0; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs[index];
        const text = getTinyParagraphText(paragraph);

        if (remaining <= text.length || index === paragraphs.length - 1) {
            return {
                paragraph,
                offset: Math.min(remaining, text.length)
            };
        }

        remaining -= text.length + 1;
    }

    const lastParagraph = paragraphs[paragraphs.length - 1];
    return {
        paragraph: lastParagraph,
        offset: getTinyParagraphText(lastParagraph).length
    };
};

const resolveTinyTextPoint = (paragraph, charOffset) => {
    const safeOffset = Math.max(0, charOffset);
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let remaining = safeOffset;
    let textNode = walker.nextNode();

    if (!textNode) {
        return { node: paragraph, offset: 0 };
    }

    while (textNode) {
        const length = textNode.textContent?.length || 0;

        if (remaining <= length) {
            return { node: textNode, offset: remaining };
        }

        remaining -= length;
        textNode = walker.nextNode();
    }

    return { node: paragraph, offset: paragraph.childNodes.length };
};

const restoreTinyMdeSelection = (start, end = start) => {
    requestAnimationFrame(() => {
        const editorElement = getTinyMdeEditorElement();
        if (!editorElement) return;

        const startTarget = resolveTinySourceIndex(start);
        const endTarget = resolveTinySourceIndex(end);
        if (!startTarget || !endTarget) return;

        const startPoint = resolveTinyTextPoint(startTarget.paragraph, startTarget.offset);
        const endPoint = resolveTinyTextPoint(endTarget.paragraph, endTarget.offset);
        const range = document.createRange();

        try {
            range.setStart(startPoint.node, startPoint.offset);
            range.setEnd(endPoint.node, endPoint.offset);
        } catch {
            return;
        }

        const selection = window.getSelection();
        if (!selection) return;

        selection.removeAllRanges();
        selection.addRange(range);
        editorElement.focus();
        lastEditorSelection = {
            mode: "tinymde",
            content: editor.getContent(),
            start,
            end
        };
    });
};

const applyEditorContent = async (content, start, end = start) => {
    if (editor) {
        editor.setContent(content);
        scheduleRichEditorHeightSync(true);
        restoreTinyMdeSelection(start, end);
        return;
    }

    if (editorFallback) {
        editorFallback.value = content;
        editorFallback.focus();
        editorFallback.setSelectionRange(start, end);
        autoResizeEditorFallback(true);
        lastEditorSelection = {
            mode: "textarea",
            content,
            start,
            end
        };
    }
};

const applyEditorTransform = async (transform) => {
    const state = getEditorSelectionState();
    const result = transform(state);

    if (!result || typeof result.content !== "string") {
        return;
    }

    await applyEditorContent(result.content, result.start ?? state.start, result.end ?? result.start ?? state.end);
};

const wrapSelection = (prefix, suffix, placeholder) =>
    applyEditorTransform((state) => {
        const selectedText = state.content.slice(state.start, state.end);
        const body = selectedText || placeholder;
        const replacement = `${prefix}${body}${suffix}`;

        return {
            content: `${state.content.slice(0, state.start)}${replacement}${state.content.slice(state.end)}`,
            start: state.start + prefix.length,
            end: state.start + prefix.length + body.length
        };
    });

const replaceSelectedLines = (lineFormatter) =>
    applyEditorTransform((state) => {
        const start = state.start;
        const end = state.end;
        const blockStart = state.content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
        let blockEnd = state.content.indexOf("\n", end);

        if (blockEnd === -1) {
            blockEnd = state.content.length;
        }

        const originalBlock = state.content.slice(blockStart, blockEnd);
        const lines = originalBlock.split("\n");
        const formattedLines = lines.map((line, index) => lineFormatter(line, index));
        const replacement = formattedLines.join("\n");

        return {
            content: `${state.content.slice(0, blockStart)}${replacement}${state.content.slice(blockEnd)}`,
            start: blockStart,
            end: blockStart + replacement.length
        };
    });

const stripBlockPrefix = (line) => line.replace(/^(#{1,6}\s+|>\s+|-\s+|\d+\.\s+)/, "");

const insertBlockSnippet = (snippet, selectText = "") =>
    applyEditorTransform((state) => {
        const before = state.content.slice(0, state.start);
        const after = state.content.slice(state.end);
        const prefix = before && !before.endsWith("\n") ? "\n" : "";
        const suffix = after && !after.startsWith("\n") ? "\n" : "";
        const replacement = `${prefix}${snippet}${suffix}`;
        const selectionStart = state.start + prefix.length + replacement.indexOf(selectText || snippet.trim());
        const selectionEnd = selectText
            ? selectionStart + selectText.length
            : selectionStart;

        return {
            content: `${before}${replacement}${after}`,
            start: Math.max(state.start + prefix.length, selectionStart),
            end: Math.max(state.start + prefix.length, selectionEnd)
        };
    });

const handleEditorToolbarCommand = async (command, rawValue = "") => {
    await ensureEditor();

    switch (command) {
        case "bold":
            await wrapSelection("**", "**", "粗体文本");
            break;
        case "italic":
            await wrapSelection("*", "*", "斜体文本");
            break;
        case "strike":
            await wrapSelection("~~", "~~", "删除线");
            break;
        case "code":
            await wrapSelection("`", "`", "code");
            break;
        case "link":
            await applyEditorTransform((state) => {
                const selectedText = state.content.slice(state.start, state.end);
                const label = selectedText || "链接文本";
                const url = "https://example.com";
                const replacement = `[${label}](${url})`;
                const labelStart = state.start + 1;
                const urlStart = state.start + label.length + 3;

                return {
                    content: `${state.content.slice(0, state.start)}${replacement}${state.content.slice(state.end)}`,
                    start: selectedText ? urlStart : labelStart,
                    end: selectedText ? urlStart + url.length : labelStart + label.length
                };
            });
            break;
        case "heading": {
            const level = Math.min(6, Math.max(1, Number(rawValue) || 1));
            const prefix = `${"#".repeat(level)} `;
            await replaceSelectedLines((line) => `${prefix}${stripBlockPrefix(line)}`);
            break;
        }
        case "quote":
            await replaceSelectedLines((line) => `> ${stripBlockPrefix(line)}`);
            break;
        case "bullet":
            await replaceSelectedLines((line) => `- ${stripBlockPrefix(line)}`);
            break;
        case "ordered":
            await replaceSelectedLines((line, index) => `${index + 1}. ${stripBlockPrefix(line)}`);
            break;
        case "codeblock": {
            const state = getEditorSelectionState();
            const body = state.content.slice(state.start, state.end) || "代码内容";
            await insertBlockSnippet(`\n\`\`\`\n${body}\n\`\`\`\n`, body);
            break;
        }
        case "table":
            await insertBlockSnippet("| 列 1 | 列 2 |\n| --- | --- |\n| 内容 1 | 内容 2 |\n", "内容 1");
            break;
        case "divider":
            await insertBlockSnippet("---\n");
            break;
        default:
            break;
    }
};

const ensureTinyMdeMount = () => {
    let mount = editorHost.querySelector(TINYMDE_MOUNT_SELECTOR);

    if (!mount) {
        mount = document.createElement("div");
        mount.id = "tinymde-mount";
        mount.className = "tinymde-mount";
        mount.dataset.editorMount = "tinymde";
        editorHost.replaceChildren(mount);
    }

    return mount;
};

const measureRichEditorHeight = () => {
    const root = getTinyMdeRoot();
    const editorElement = getTinyMdeEditorElement();
    if (!root || !editorElement) return getEditorMinimumHeight();

    const contentHeight = Math.max(
        getEditorMinimumContentHeight(),
        editorElement.scrollHeight || 0,
        editorElement.offsetHeight || 0
    );

    return Math.max(getEditorMinimumHeight(), Math.ceil(contentHeight + 2));
};

const syncRichEditorHeight = (allowShrink = false) => {
    const root = getTinyMdeRoot();
    const editorElement = getTinyMdeEditorElement();
    if (!root || !editorElement) return;

    const desiredHeight = measureRichEditorHeight();
    const currentHeight = parseInt(root.style.height || "0", 10) || root.offsetHeight || getEditorMinimumHeight();

    if (allowShrink || desiredHeight > currentHeight) {
        root.style.height = `${desiredHeight}px`;
        editorElement.style.minHeight = `${Math.max(getEditorMinimumContentHeight(), desiredHeight - 2)}px`;
    }
};

const scheduleRichEditorHeightSync = (allowShrink = false) => {
    requestAnimationFrame(() => syncRichEditorHeight(allowShrink));
};

const syncEditorHeightWhenVisible = (allowShrink = false) => {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (editView.classList.contains("hidden")) return;

            if (editor) {
                syncRichEditorHeight(allowShrink);
                return;
            }

            autoResizeEditorFallback(allowShrink);
        });
    });
};

const leaveEditView = (didSave = false) => {
    setEditMessage("");

    if (didSave) {
        notifyDocsChanged();
    }

    if (window.opener && window.opener !== window) {
        window.close();
        window.setTimeout(() => {
            if (!window.closed) {
                navigateTo("/docs");
            }
        }, 80);
        return;
    }

    navigateTo("/docs");
};

const requestShareInfo = async (id, rotate = false) =>
    api(`/api/docs/${id}/share`, {
        method: "POST",
        ...(rotate ? { body: JSON.stringify({ rotate: true }) } : {})
    });

const showDialog = ({ title, message, confirmText = "确认", cancelText = "取消", input = null, fields = null }) =>
    new Promise((resolve) => {
        dialogTitle.textContent = title;
        dialogMessage.textContent = message || "";
        dialogConfirmBtn.textContent = confirmText;
        dialogCancelBtn.textContent = cancelText;

        let fieldInputs = [];

        if (fields && fields.length) {
            dialogInputWrap.classList.add("hidden");
            dialogInput.value = "";

            dialogFormWrap.classList.remove("hidden");
            dialogFormWrap.innerHTML = "";

            fieldInputs = fields.map((field) => {
                const row = document.createElement("div");
                row.className = "form-row";

                const label = document.createElement("label");
                label.textContent = field.label;
                label.htmlFor = `dialogField_${field.name}`;

                const inputEl = document.createElement("input");
                inputEl.id = `dialogField_${field.name}`;
                inputEl.type = field.type || "text";
                inputEl.placeholder = field.placeholder || "";
                inputEl.value = field.defaultValue || "";
                inputEl.dataset.name = field.name;

                row.appendChild(label);
                row.appendChild(inputEl);
                dialogFormWrap.appendChild(row);
                return inputEl;
            });

            requestAnimationFrame(() => {
                if (fieldInputs[0]) fieldInputs[0].focus();
            });
        } else if (input) {
            dialogInputWrap.classList.remove("hidden");
            dialogInput.type = input.type || "text";
            dialogInput.value = input.defaultValue || "";
            dialogInput.placeholder = input.placeholder || "";
            dialogFormWrap.classList.add("hidden");
            dialogFormWrap.innerHTML = "";
            requestAnimationFrame(() => dialogInput.focus());
        } else {
            dialogInputWrap.classList.add("hidden");
            dialogInput.value = "";
            dialogFormWrap.classList.add("hidden");
            dialogFormWrap.innerHTML = "";
        }

        dialogMask.classList.remove("hidden");

        const cleanup = () => {
            dialogMask.classList.add("hidden");
            dialogFormWrap.classList.add("hidden");
            dialogFormWrap.innerHTML = "";
            dialogConfirmBtn.onclick = null;
            dialogCancelBtn.onclick = null;
            dialogMask.onclick = null;
        };

        dialogConfirmBtn.onclick = () => {
            let value = true;
            if (fields && fields.length) {
                value = fieldInputs.reduce((acc, fieldInput) => {
                    acc[fieldInput.dataset.name] = fieldInput.value;
                    return acc;
                }, {});
            } else if (input) {
                value = dialogInput.value;
            }
            cleanup();
            resolve(value);
        };

        dialogCancelBtn.onclick = () => {
            cleanup();
            resolve(null);
        };

        dialogMask.onclick = (event) => {
            if (event.target === dialogMask) {
                cleanup();
                resolve(null);
            }
        };
    });

const confirmDialog = async (message, title = "确认操作") => {
    const result = await showDialog({ title, message });
    return result === true;
};

const clearErrorView = () => {
    errorView.classList.add("hidden");
};

const showErrorView = (title, message, retryHandler = null, options = {}) => {
    const { showActions = true, eyebrow = "运行异常" } = options;
    pendingRetry = retryHandler;
    errorEyebrow.textContent = eyebrow;
    errorTitle.textContent = title;
    errorDescription.textContent = message;
    errorActions.classList.toggle("hidden", !showActions);
    appChrome.classList.add("hidden");
    [authView, listView, editView, shareView].forEach((item) => item.classList.add("hidden"));
    dialogMask.classList.add("hidden");
    closeShareDialog();
    errorView.classList.remove("hidden");
    errorView.classList.remove("view-enter");
    requestAnimationFrame(() => errorView.classList.add("view-enter"));
};

const setView = (view) => {
    clearErrorView();
    appChrome.classList.toggle("hidden", view === authView || view === editView || view === shareView);
    [authView, listView, editView, shareView, errorView].forEach((item) => item.classList.add("hidden"));
    dialogMask.classList.add("hidden");
    closeShareDialog();
    view.classList.remove("hidden");
    view.classList.remove("view-enter");
    requestAnimationFrame(() => view.classList.add("view-enter"));
};

const setAuthMessage = (msg) => {
    authMsg.textContent = msg || "";
};

const setEditMessage = (msg) => {
    editMsg.textContent = msg || "";
};

const showLogin = () => setView(authView);
const showList = () => {
    appTitle.textContent = "文档工作台";
    setView(listView);
};
const showEdit = () => {
    setView(editView);
    syncEditorHeightWhenVisible(true);
    // 延迟确保 DOM 已更新，然后聚焦编辑器
    requestAnimationFrame(() => {
        const editorElement = getTinyMdeEditorElement() || editorFallback;
        if (editorElement) {
            editorElement.focus();
        }
    });
};
const showShare = () => setView(shareView);

const renderDocList = () => {
    docListEl.innerHTML = "";

    if (!docs.length) {
        docListEl.innerHTML = `
      <div class="empty-panel">
        <h3>还没有文档</h3>
        <p>点击上方“新建文档”开始写第一篇 Markdown。</p>
        <button type="button" class="empty-action">新建文档</button>
      </div>
    `;

        const emptyBtn = docListEl.querySelector(".empty-action");
        emptyBtn.onclick = () => withBusy(chromeNewDocBtn, createDoc, "创建中...").catch((err) => notify(err.message, "error"));
        return;
    }

    docs.forEach((doc, index) => {
        const row = document.createElement("article");
        row.className = "doc-row";
        row.style.setProperty("--stagger-index", String(index));
        row.innerHTML = `
      <div class="doc-main">
        <strong>${doc.title || "未命名文档"}</strong>
                <small>更新时间：${formatLocalDateTime(doc.updatedAt)}</small>
      </div>
      <div class="doc-actions">
        <button type="button" class="ghost doc-action-view">查看</button>
        <button type="button" class="ghost doc-action-edit">编辑</button>
        <button type="button" class="ghost doc-action-share">分享</button>
        <button type="button" class="danger doc-action-delete">删除</button>
      </div>
    `;

        const viewBtn = row.querySelector(".doc-action-view");
        const editBtn = row.querySelector(".doc-action-edit");
        const shareActionBtn = row.querySelector(".doc-action-share");
        const deleteActionBtn = row.querySelector(".doc-action-delete");

        viewBtn.onclick = () => withBusy(viewBtn, () => openSharedDocById(doc.id), "打开中...").catch((err) => notify(err.message, "error"));
        editBtn.onclick = () => withBusy(editBtn, () => openEditWindow(doc.id), "打开中...").catch((err) => notify(err.message, "error"));
        shareActionBtn.onclick = () => withBusy(shareActionBtn, () => openShareDialogById(doc.id), "生成中...").catch((err) => notify(err.message, "error"));
        deleteActionBtn.onclick = () => withBusy(deleteActionBtn, () => deleteDocById(doc.id), "删除中...").catch((err) => notify(err.message, "error"));

        docListEl.appendChild(row);
    });
};

const loadDocs = async () => {
    const data = await api("/api/docs");
    docs = data.docs || [];
    renderDocList();
};

const ensureEditor = async () => {
    if (editor) return editor;
    if (editorLoading) return editorLoading;

    editorLoading = (async () => {
        if (!window.TinyMDE || !window.TinyMDE.create) {
            const scriptUrls = [TINYMDE_SCRIPT_URL];

            let loaded = false;
            for (const url of scriptUrls) {
                try {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement("script");
                        script.src = url;
                        script.onload = resolve;
                        script.onerror = () => reject(new Error("编辑器加载失败"));
                        document.head.appendChild(script);
                    });
                    loaded = true;
                    break;
                } catch {
                    // try next CDN
                }
            }

            if (!loaded && (!window.TinyMDE || !window.TinyMDE.create)) {
                notify("编辑器加载失败，已切换为基础文本模式", "error");
            }
        }

        if (window.TinyMDE && window.TinyMDE.create) {
            try {
                ensureTinyMdeMount();
                editor = window.TinyMDE.create("#tinymde-mount", {
                    showToolbar: false,
                    showWordCount: false
                });
                installTinyMdeMacShortcutBridge();
                installTinyMdeDeleteKeyFix();
                editor.addEventListener("on-change", () => scheduleRichEditorHeightSync(false));
                scheduleRichEditorHeightSync(true);
                return editor;
            } catch (error) {
                console.error(error);
                notify("TinyMDE 初始化失败，已切换为基础文本模式", "error");
            }
        }

        if (!editorFallback) {
            editorFallback = document.createElement("textarea");
            editorFallback.className = "editor-fallback";
            editorFallback.placeholder = "Markdown 内容";
            editorFallback.addEventListener("input", () => autoResizeEditorFallback(false));
            editorFallback.addEventListener("select", cacheEditorSelection);
            editorFallback.addEventListener("click", cacheEditorSelection);
            editorFallback.addEventListener("keyup", cacheEditorSelection);
            editorHost.replaceChildren(editorFallback);
            autoResizeEditorFallback(true);
        }

        return null;
    })();

    return editorLoading;
};

const setEditorValue = async (value) => {
    const instance = await ensureEditor();
    if (instance) {
        instance.setContent(value || "");
        scheduleRichEditorHeightSync(true);
        return;
    }

    if (editorFallback) {
        editorFallback.value = value || "";
        autoResizeEditorFallback(true);
    }
};

const getEditorValue = () => {
    if (editor) return editor.getContent();
    if (editorFallback) return editorFallback.value;
    return "";
};

const renderEdit = async (doc, content) => {
    currentDoc = doc;
    editHeaderTitle.textContent = doc.title || "未命名文档";
    editMeta.textContent = `更新时间：${formatLocalDateTime(doc.updatedAt)}`;
    docTitle.value = doc.title || "";
    await setEditorValue(content || "");
};

const loadEdit = async (id) => {
    setEditMessage("");
    const data = await api(`/api/docs/${id}`);
    await renderEdit(data.doc, data.content);
    showEdit();
};

const openShare = async (token) => {
    try {
        const data = await api(`/api/public/${token}`);
        publicTitle.textContent = data.title || "共享文档";
        publicDate.textContent = `更新时间：${formatLocalDateTime(data.updatedAt)}`;
        publicContent.innerHTML = renderMarkdown(data.content || "");
        showShare();
    } catch (error) {
        const message = error instanceof Error ? error.message : "这个分享链接已经不可用。";
        const expired = /失效|不存在|无效/.test(message);
        showErrorView(
            expired ? "分享链接已失效" : "分享页面暂时不可用",
            message,
            null,
            { showActions: false, eyebrow: expired ? "链接状态" : "页面状态" }
        );
    }
};

const openShareDialogById = async (id) => {
    const data = await requestShareInfo(id);
    showShareDialog(data.shareUrl, id);
    return data;
};

const refreshShareDialogLink = async () => {
    if (!activeShareDocId) {
        throw new Error("当前没有可更换的分享链接");
    }

    const data = await requestShareInfo(activeShareDocId, true);
    showShareDialog(data.shareUrl, activeShareDocId);
    return data;
};

const openSharedDocById = async (id) => {
    const pendingWindow = openPendingWindow("打开中...", "正在打开分享页面...");

    try {
        const data = await requestShareInfo(id);
        const target = getShareLinkTarget(data.shareUrl);

        if (pendingWindow && !pendingWindow.closed) {
            pendingWindow.location.replace(target.href);
            return data;
        }

        throw new Error("浏览器阻止了新页面，请允许弹出窗口后重试");
    } catch (error) {
        if (pendingWindow && !pendingWindow.closed) {
            pendingWindow.close();
        }
        throw error;
    }
};

const deleteDocById = async (id) => {
    const ok = await confirmDialog("确认删除该文档吗？", "删除文档");
    if (!ok) return;
    await api(`/api/docs/${id}`, { method: "DELETE" });
    if (currentDoc && currentDoc.id === id) currentDoc = null;
    await loadDocs();
    notify("文档已删除", "success");
    navigateTo("/docs");
};

const createDoc = async () => {
    const pendingWindow = openPendingWindow("创建中...", "正在创建文档并打开独立编辑页...");

    try {
        const data = await api("/api/docs", {
            method: "POST",
            body: JSON.stringify({ title: "新文档", content: "# 新文档\n" })
        });
        await loadDocs();
        notify("已创建新文档", "success");

        const editUrl = new URL(`/docs/${data.doc.id}/edit`, window.location.origin).toString();
        if (pendingWindow && !pendingWindow.closed) {
            pendingWindow.location.replace(editUrl);
            return;
        }

        throw new Error("浏览器阻止了编辑窗口，请允许弹出窗口后重试");
    } catch (error) {
        if (pendingWindow && !pendingWindow.closed) {
            pendingWindow.close();
        }
        throw error;
    }
};

const saveDoc = async () => {
    if (!currentDoc) return;
    const markdown = getEditorValue();
    const data = await api(`/api/docs/${currentDoc.id}`, {
        method: "PUT",
        body: JSON.stringify({
            title: docTitle.value || "未命名文档",
            content: markdown
        })
    });
    currentDoc = data.doc;
    setEditMessage("已保存");
    if (!window.opener) {
        notify("已保存", "success");
    }
    leaveEditView(true);
};

const changePassword = async () => {
    const form = await showDialog({
        title: "修改账户",
        message: "请先输入当前密码验证身份；新密码留空表示不修改。",
        confirmText: "保存",
        fields: [
            { name: "oldPassword", label: "当前密码", type: "password", placeholder: "请输入当前密码" },
            {
                name: "newUsername",
                label: "新账号名",
                type: "text",
                placeholder: "3-32位，字母数字下划线或短横线",
                defaultValue: currentUsername || ""
            },
            { name: "newPassword", label: "新密码", type: "password", placeholder: "留空则不修改密码" }
        ]
    });
    if (!form) return;

    const oldPassword = String(form.oldPassword || "");
    const newUsername = String(form.newUsername || "").trim();
    const newPassword = String(form.newPassword || "").trim();

    if (!oldPassword) {
        throw new Error("当前密码不能为空");
    }

    if (!newUsername) {
        throw new Error("账号名不能为空");
    }

    if (!newPassword && newUsername === currentUsername) {
        notify("未做任何修改", "info");
        return;
    }

    const payload = {
        oldPassword,
        newUsername,
        newPassword: newPassword || undefined
    };

    const data = await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify(payload)
    });

    currentUsername = data.username || newUsername;
    userLabel.textContent = `当前用户：${currentUsername}`;
    notify("账户信息已更新", "success");
};

const route = async () => {
    const path = window.location.pathname;

    const shareMatch = path.match(/^(?:\/share|\/s)\/([^/]+)$/);
    if (shareMatch) {
        await openShare(shareMatch[1]);
        return;
    }

    const me = await api("/api/auth/me", { method: "GET" }).catch(() => null);

    if (path === "/" || path === "/login") {
        if (me) {
            navigateTo("/docs");
            return;
        }
        showLogin();
        return;
    }

    if (path === "/docs") {
        if (!me) {
            navigateTo("/login");
            return;
        }
        currentUsername = me.username;
        userLabel.textContent = `当前用户：${me.username}`;
        await loadDocs();
        showList();
        return;
    }

    const detailMatch = path.match(/^\/docs\/([^/]+)$/);
    if (detailMatch) {
        if (!me) {
            navigateTo("/login");
            return;
        }
        replaceTo("/docs");
        return;
    }

    const editMatch = path.match(/^\/docs\/([^/]+)\/edit$/);
    if (editMatch) {
        if (!me) {
            navigateTo("/login");
            return;
        }
        currentUsername = me.username;
        await loadEdit(editMatch[1]);
        return;
    }

    replaceTo("/docs");
};

const routeSafe = async () => {
    try {
        await route();
    } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        showErrorView("页面加载失败", message, () => routeSafe());
    }
};

const replaceTo = (path) => {
    history.replaceState({}, "", path);
    return routeSafe();
};

const navigateTo = (path) => {
    history.pushState({}, "", path);
    return routeSafe();
};

loginBtn.onclick = async () => {
    await withBusy(loginBtn, async () => {
        setAuthMessage("");
        await api("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                username: loginUser.value.trim(),
                password: loginPassword.value
            })
        });
        notify("登录成功", "success");
        navigateTo("/docs");
    }, "登录中...").catch((err) => setAuthMessage(err.message));
};

logoutBtn.onclick = async () => {
    await withBusy(logoutBtn, async () => {
        await api("/api/auth/logout", { method: "POST" });
        notify("已退出", "success");
        navigateTo("/login");
    }, "退出中...").catch((err) => notify(err.message, "error"));
};

changePwdBtn.onclick = async () => {
    await withBusy(changePwdBtn, async () => {
        await changePassword();
    }, "修改中...").catch((err) => notify(err.message, "error"));
};

if (chromeNewDocBtn) {
    chromeNewDocBtn.onclick = () => withBusy(chromeNewDocBtn, createDoc, "创建中...").catch((err) => notify(err.message, "error"));
}

if (chromeRefreshBtn) {
    chromeRefreshBtn.onclick = () => withBusy(chromeRefreshBtn, async () => {
        await loadDocs();
        notify("已刷新", "success");
    }, "刷新中...").catch((err) => notify(err.message, "error"));
}

shareCopyBtn.onclick = () => withBusy(shareCopyBtn, async () => {
    const copied = await copyText(activeShareUrl);
    if (!copied) {
        shareLinkInput.focus();
        shareLinkInput.select();
        throw new Error("复制失败，请手动复制链接");
    }
    notify("分享链接已复制", "success");
}, "复制中...").catch((err) => notify(err.message, "error"));

shareRefreshBtn.onclick = () => withBusy(shareRefreshBtn, async () => {
    await refreshShareDialogLink();
    notify("分享链接已更换，旧链接已失效", "success");
}, "更换中...").catch((err) => notify(err.message, "error"));

shareOpenBtn.onclick = (event) => {
    if (activeShareUrl) return;
    event.preventDefault();
    notify("分享链接尚未生成", "error");
};

shareCloseBtn.onclick = () => closeShareDialog();

shareLinkInput.onclick = () => shareLinkInput.select();

shareDialog.onclick = (event) => {
    if (event.target === shareDialog) {
        closeShareDialog();
    }
};

saveBtn.onclick = () => withBusy(saveBtn, saveDoc, "保存中...").catch((err) => setEditMessage(err.message));

cancelEditBtn.onclick = () => {
    leaveEditView(false);
};

errorRetryBtn.onclick = () => {
    if (pendingRetry) {
        pendingRetry();
        return;
    }
    routeSafe();
};

errorBackBtn.onclick = () => navigateTo("/docs");

window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== "docs:refresh") return;
    if (window.location.pathname !== "/docs") return;
    loadDocs().catch((err) => notify(err.message, "error"));
});

document.addEventListener("selectionchange", () => {
    const editorElement = getTinyMdeEditorElement();
    const selection = window.getSelection();

    if (!editorElement || !selection || !editorElement.contains(selection.anchorNode)) {
        return;
    }

    cacheEditorSelection();
});

if (editorToolbar) {
    editorToolbar.addEventListener("mousedown", (event) => {
        const button = event.target.closest(".editor-toolbar-btn");
        if (button) {
            event.preventDefault();
        }
    });

    editorToolbar.addEventListener("click", (event) => {
        const button = event.target.closest(".editor-toolbar-btn");
        if (!button) return;

        handleEditorToolbarCommand(button.dataset.command || "", button.dataset.value || "")
            .catch((error) => notify(error instanceof Error ? error.message : "工具栏操作失败", "error"));
    });
}

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !shareDialog.classList.contains("hidden")) {
        closeShareDialog();
        return;
    }

    const mainKey = hasPrimaryModifier(event);

    if (!mainKey) return;

    if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        withBusy(chromeNewDocBtn, createDoc, "创建中...").catch((err) => notify(err.message, "error"));
    }

    if (event.key.toLowerCase() === "s" && !editView.classList.contains("hidden")) {
        event.preventDefault();
        withBusy(saveBtn, saveDoc, "保存中...").catch((err) => setEditMessage(err.message));
    }

});

window.addEventListener("popstate", () => routeSafe());

(async () => {
    await routeSafe();
})();
