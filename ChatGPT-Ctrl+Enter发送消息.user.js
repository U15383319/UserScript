// ==UserScript==
// @name         ChatGPT Ctrl+Enter 发送消息
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在 ChatGPT、Gemini、Deepseek 等聊天界面中，使用 Ctrl + Enter 发送消息，单独按 Enter 则换行。
// @author       Gvxswur
// @match        https://chatgpt.com/*
// @match        https://gemini.google.com/*
// @match        https://www.qianwen.com/*
// @match        https://chat.deepseek.com/*
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // Function to find the textarea element
    function findTextarea() {
        return document.querySelector('div[contenteditable="true"]') || // ChatGPT Gemini Claude
            document.querySelector('textarea'); // Deepseek Qianwen
    }

    // Function to find and click the send button
    function clickSendButton() {
        const selecters = [
            'button[aria-label^="Send"]', // ChatGPT Gemini Claude
            'button[aria-label^="发送"]',
            'button[aria-label^="Submit"]',
            'button[aria-label^="提交"]',
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

    function defaultInsertNewLine(textarea) {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);

        // Delete any selected content first
        range.deleteContents();

        if (textarea.className.startsWith('ProseMirror')) {
            const br = document.createElement('br');
            range.insertNode(br);
            range.setStartAfter(br);
            range.setEndAfter(br);
        } else {
            // Find the current block-level parent (likely a <p> or the contenteditable itself)
            let currentBlock = range.startContainer;
            while (currentBlock && currentBlock !== textarea) {
                if (currentBlock.nodeType === Node.ELEMENT_NODE &&
                    currentBlock.tagName === 'P') {
                    break;
                }
                currentBlock = currentBlock.parentNode;
            }

            // Create new paragraph
            const newP = document.createElement('p');
            const br = document.createElement('br');
            newP.appendChild(br);

            if (currentBlock && currentBlock.tagName === 'P') {
                // Insert the new paragraph after the current one
                currentBlock.parentNode.insertBefore(newP, currentBlock.nextSibling);
            } else {
                // Fallback: append to textarea
                textarea.appendChild(newP);
            }

            // Place cursor inside the new paragraph
            range.setStart(newP, 0);
            range.setEnd(newP, 0);
        }

        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
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
            // For regular textareas
            if (textarea.tagName.toLowerCase() === 'textarea') { // Qianwen DeepSeek
                e.stopPropagation(); // allow default behavior
            }
            // For contenteditable divs
            else if (textarea.getAttribute('contenteditable') === 'true') { // ChatGPT Gemini Claude
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                defaultInsertNewLine(textarea);
            }
        }
    }, true); // Use capture phase to intercept before Claude's handlers

})();
