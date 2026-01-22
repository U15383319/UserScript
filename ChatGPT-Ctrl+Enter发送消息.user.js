// ==UserScript==
// @name         ChatGPT Ctrl+Enter 发送消息
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在 ChatGPT、Claude、Gemini 等聊天界面中，使用 Ctrl + Enter 发送消息，单独按 Enter 则换行。
// @author       Gvxswur
// @match        https://chatgpt.com/*
// @match        https://claude.ai/*
// @match        https://gemini.google.com/*
// @match        https://copilot.microsoft.com/*
// @match        https://www.qianwen.com/*
// @match        https://chat.deepseek.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // Function to find the textarea element
    function findTextarea() {
        return document.querySelector('div[contenteditable="true"]') || // ChatGPT Gemini Claude Copilot
            document.querySelector('textarea'); // Deepseek Qianwen
    }

    // Function to find and click the send button
    function clickSendButton() {
        const selecters = [
            'button[aria-label^="Send"]', // ChatGPT Gemini Claude
            'button[aria-label^="发送"]',
            'button[aria-label^="Submit"]', // Copilot
            'div[role="button"]:has(path[d^="M8.3125"])', // DeepSeek
            'div[class^="operateBtn"]'// Qianwen
        ];
        const sendButton = selecters.map(sel => document.querySelector(sel)).find(btn => btn);

        if (sendButton) {
            sendButton.click();
            return true;
        }
        return false;
    }

    // Add event listener to capture keydown events
    document.addEventListener('keydown', function (e) {
        const textarea = findTextarea();

        // Check if we're in the textarea
        if (!textarea || !textarea.contains(e.target)) {
            return;
        }

        // Ctrl+Enter (or Cmd+Enter on Mac) should send the message
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            clickSendButton();
        }
        // Plain Enter should insert a newline (allow default behavior)
        else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation(); // Stop Claude from intercepting it

            // Insert newline at cursor position
            if (textarea.getAttribute('contenteditable') === 'true') {
                // Insert newline in contenteditable div
                const selection = window.getSelection();
                const range = selection.getRangeAt(0);

                // Delete any selected content first
                range.deleteContents();

                // Create a line break element
                const br = document.createElement('br');
                range.insertNode(br);

                // Create another br for proper cursor positioning (some browsers need this)
                // const br2 = document.createElement('br');
                // range.insertNode(br2);

                // Move cursor after the line break
                range.setStartAfter(br);
                range.setEndAfter(br);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                // For regular textarea, insert newline at cursor position
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const value = textarea.value;
                textarea.value = value.substring(0, start) + '\n' + value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + 1;
            }

            // Trigger input event so the app knows content changed
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, true); // Use capture phase to intercept before Claude's handlers

})();
