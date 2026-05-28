const TOAST_EDITOR_HEIGHT = "560px";

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
const saveBtn = document.getElementById("saveBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editorHost = document.getElementById("editor");

const publicTitle = document.getElementById("publicTitle");
const publicDate = document.getElementById("publicDate");
const publicContent = document.getElementById("publicContent");
const shareViewActions = document.getElementById("shareViewActions");
const shareViewBackBtn = document.getElementById("shareViewBackBtn");
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
let currentUsername = "";
let activeShareUrl = "";
let activeShareDocId = "";
let pendingRetry = null;

let editorInstance = null;
let editorValue = "";
let viewerInstance = null;

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
            // fallback below
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

const getShareLinkTarget = (shareUrl) => {
    try {
        const url = new URL(shareUrl, window.location.href);
        return { href: url.toString() };
    } catch {
        return { href: shareUrl };
    }
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

const requestShareInfo = async (id, rotate = false) =>
    api(`/api/docs/${id}/share`, {
        method: "POST",
        ...(rotate ? { body: JSON.stringify({ rotate: true }) } : {})
    });

const openPendingWindow = (title, message) => {
    const pendingWindow = window.open("about:blank", "_blank");

    if (pendingWindow && pendingWindow.document) {
        pendingWindow.document.title = title;
        pendingWindow.document.body.innerHTML = `<p style="margin:40px auto;max-width:480px;font:16px/1.6 sans-serif;color:#1f1d1a;text-align:center;">${message}</p>`;
    }

    return pendingWindow;
};

const getEditUrl = (id) => new URL(`/docs/${id}/edit`, window.location.origin).toString();

const openEditWindow = async (id) => {
    const pendingWindow = openPendingWindow("打开中...", "正在打开独立编辑页...");
    const editUrl = getEditUrl(id);

    if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.location.replace(editUrl);
        return;
    }

    throw new Error("浏览器阻止了编辑窗口，请允许弹出窗口后重试");
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

const mountEditor = (value = "") => {
    editorValue = value || "";

    if (editorInstance && typeof editorInstance.destroy === "function") {
        editorInstance.destroy();
    }

    const ToastEditor = window.toastui?.Editor;
    if (typeof ToastEditor !== "function") {
        throw new Error("Toast UI Editor 加载失败，请检查网络连接后重试");
    }

    editorHost.replaceChildren();
    editorInstance = new ToastEditor({
        el: editorHost,
        initialValue: editorValue,
        initialEditType: "markdown",
        previewStyle: "vertical",
        height: TOAST_EDITOR_HEIGHT,
        usageStatistics: false
    });

    return editorInstance;
};

const ensureEditor = async () => {
    if (editorInstance) return editorInstance;
    return mountEditor(editorValue);
};

const setEditorValue = async (value) => {
    mountEditor(value || "");
};

const getEditorValue = async () => {
    const instance = await ensureEditor();
    if (typeof instance.getMarkdown === "function") {
        editorValue = instance.getMarkdown();
    } else if (typeof instance.getHTML === "function") {
        editorValue = instance.getHTML();
    } else {
        const fallbackInput =
            editorHost.querySelector(".toastui-editor-md-container textarea") ||
            editorHost.querySelector("textarea");
        editorValue = fallbackInput ? fallbackInput.value : "";
    }
    return editorValue;
};

const renderPublicMarkdown = (content) => {
    const value = content || "";
    const ToastEditor = window.toastui?.Editor;

    if (typeof ToastEditor !== "function") {
        publicContent.textContent = value;
        return;
    }

    if (viewerInstance && typeof viewerInstance.destroy === "function") {
        viewerInstance.destroy();
    }

    publicContent.replaceChildren();
    viewerInstance = ToastEditor.factory({
        el: publicContent,
        viewer: true,
        initialValue: value,
        usageStatistics: false
    });
};

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
    requestAnimationFrame(() => {
        const input = editorHost.querySelector(".toastui-editor-md-container textarea") ||
            editorHost.querySelector(".toastui-editor-main") ||
            editorHost.querySelector("textarea");
        if (input) input.focus();
    });
};
const showShare = (inApp = false) => {
    shareViewActions.classList.toggle("hidden", !inApp);
    setView(shareView);
};

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
        <button type="button" class="ghost doc-action-edit">编辑</button>
        <button type="button" class="ghost doc-action-share">分享</button>
        <button type="button" class="danger doc-action-delete">删除</button>
      </div>
    `;

        const editBtn = row.querySelector(".doc-action-edit");
        const shareActionBtn = row.querySelector(".doc-action-share");
        const deleteActionBtn = row.querySelector(".doc-action-delete");

        row.onclick = (event) => {
            if (event.target.closest("button")) return;
            withBusy(null, async () => {
                const result = await openSharedDocById(doc.id, doc.shareToken || "");
                if (result.shareToken) {
                    doc.shareToken = result.shareToken;
                }
            }).catch((err) => notify(err.message, "error"));
        };

        editBtn.onclick = (event) => {
            event.stopPropagation();
            withBusy(editBtn, () => openEditWindow(doc.id), "打开中...").catch((err) => notify(err.message, "error"));
        };

        shareActionBtn.onclick = (event) => {
            event.stopPropagation();
            withBusy(shareActionBtn, async () => {
                const data = await openShareDialogById(doc.id);
                if (data.shareToken) {
                    doc.shareToken = data.shareToken;
                }
            }, "生成中...").catch((err) => notify(err.message, "error"));
        };

        deleteActionBtn.onclick = (event) => {
            event.stopPropagation();
            withBusy(deleteActionBtn, () => deleteDocById(doc.id), "删除中...").catch((err) => notify(err.message, "error"));
        };

        docListEl.appendChild(row);
    });
};

const loadDocs = async () => {
    const data = await api("/api/docs");
    docs = data.docs || [];
    renderDocList();
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
    showEdit();
    const data = await api(`/api/docs/${id}`);
    await renderEdit(data.doc, data.content);
};

const openShare = async (token) => {
    try {
        const data = await api(`/api/public/${token}`);
        publicTitle.textContent = data.title || "共享文档";
        publicDate.textContent = `更新时间：${formatLocalDateTime(data.updatedAt)}`;
        renderPublicMarkdown(data.content || "");
        showShare(false);
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

const openSharedDocById = async (id, knownShareToken = "") => {
    const pendingWindow = openPendingWindow("打开中...", "正在打开分享页面...");

    try {
        let shareToken = knownShareToken;
        let shareUrl = "";

        if (shareToken) {
            shareUrl = new URL(`/share/${shareToken}`, window.location.origin).toString();
        } else {
            const data = await requestShareInfo(id);
            shareToken = data.shareToken || "";
            shareUrl = data.shareUrl;
        }

        const target = getShareLinkTarget(shareUrl);
        if (pendingWindow && !pendingWindow.closed) {
            pendingWindow.location.replace(target.href);
            return { shareToken };
        }

        throw new Error("浏览器阻止了新页面，请允许弹出窗口后重试");
    } catch (error) {
        if (pendingWindow && !pendingWindow.closed) {
            pendingWindow.close();
        }
        throw error;
    }
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
    const markdown = await getEditorValue();
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

const hasPrimaryModifier = (event) => {
    const isMac = /MAC|IPHONE|IPAD|IPOD/.test(navigator.platform.toUpperCase());
    return isMac ? event.metaKey : event.ctrlKey;
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
shareViewBackBtn.onclick = () => navigateTo("/docs");
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
