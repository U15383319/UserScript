// ==UserScript==
// @name         自定义B站UP主视频音量
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  为不同UP主的视频单独保存音量设置
// @author       Gvxswur
// @match        https://www.bilibili.com/video/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';
    // 默认音量设置为4%
    const DEFAULT_VOLUME = 0.04;
    const LOG_PREFIX = '[自定义B站UP主视频音量]';
    let currentVideo = null;
    let currentVolumeChangeHandler = null;

    // 获取并返回保存的音量设置，若没有则返回默认音量
    function getSavedVolume(creatorId) {
        return parseFloat(localStorage.getItem(`creator-volume-${creatorId}`)) || DEFAULT_VOLUME;
    }

    // 保存音量设置
    function saveVolume(creatorId, volume) {
        localStorage.setItem(`creator-volume-${creatorId}`, volume);
        console.log(`${LOG_PREFIX} 已保存UP主 ${creatorId} 的音量设置: ${volume * 100}%`);
    }

    // 清除音量设置
    function clearVolume(creatorId) {
        localStorage.removeItem(`creator-volume-${creatorId}`);
        console.log(`${LOG_PREFIX} 已清除UP主 ${creatorId} 的音量设置`);
    }

    // 获取当前视频的UP主ID
    function getCreatorId() {
        // 方法1: 从页面信息中获取
        const initialState = window.__INITIAL_STATE__;
        if (initialState && initialState.upData && initialState.upData.mid) {
            return initialState.upData.mid.toString();
        }

        // 方法2: 从页面元素中获取
        const upInfoElement = document.querySelector('.up-info_right');
        if (upInfoElement) {
            const link = upInfoElement.querySelector('a.up-name');
            if (link) {
                const match = link.href.match(/space\.bilibili\.com\/(\d+)/);
                if (match) return match[1];
            }
        }

        // 方法3: 从API数据中获取
        const videoDataElement = document.querySelector('[data-v-owner]');
        if (videoDataElement) {
            const ownerData = videoDataElement.getAttribute('data-v-owner');
            if (ownerData) {
                try {
                    const owner = JSON.parse(ownerData);
                    if (owner.mid) return owner.mid.toString();
                } catch (e) {
                    console.error(`${LOG_PREFIX} 解析UP主数据失败:`, e);
                }
            }
        }

        return null;
    }

    // 等待UP主ID可用
    function waitForCreatorId(callback) {
        let attempts = 0;
        const maxAttempts = 20;
        
        const interval = setInterval(() => {
            const creatorId = getCreatorId();
            attempts++;
            
            if (creatorId) {
                clearInterval(interval);
                callback(creatorId);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.error(`${LOG_PREFIX} 无法获取UP主ID`);
            }
        }, 500);
    }

    // 设置视频音量
    function setVideoVolume(volume) {
        const video = document.querySelector('video');
        if (video) {
            video.volume = volume;
            console.log(`${LOG_PREFIX} 视频音量设置为 ${volume * 100}%`);
            return true;
        }
        return false;
    }

    // 监听视频音量变化并保存
    function monitorVolumeChange(creatorId) {
        const video = document.querySelector('video');
        if (!video) {
            console.log(`${LOG_PREFIX} 未找到视频元素`);
            return;
        }

        // 移除之前的监听器
        if (currentVideo && currentVolumeChangeHandler) {
            currentVideo.removeEventListener('volumechange', currentVolumeChangeHandler);
        }

        // 添加新的监听器
        currentVideo = video;
        currentVolumeChangeHandler = () => {
            const currentVolume = video.volume;

            // 当前音量和默认音量不同（差值大于一定阈值）才保存，否则如果恢复默认音量则清除音量的保存记录
            if (Math.abs(currentVolume - DEFAULT_VOLUME) > 0.01) {
                saveVolume(creatorId, currentVolume);
            } else {
                clearVolume(creatorId);
            }
        };

        video.addEventListener('volumechange', currentVolumeChangeHandler);

        console.log(`${LOG_PREFIX} 已开始监听音量变化`);
    }

    // 应用保存的音量设置
    function applyVolumeSettings(creatorId) {
        const savedVolume = getSavedVolume(creatorId);
        let attempts = 0;
        const maxAttempts = 20;

        const interval = setInterval(() => {
            attempts++;
            const success = setVideoVolume(savedVolume);
            
            if (success) {
                clearInterval(interval);
                console.log(`${LOG_PREFIX} 已为UP主 ${creatorId} 应用音量设置`);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.error(`${LOG_PREFIX} 无法设置视频音量`);
            }
        }, 500);
    }

    // 监听页面切换（B站使用了单页应用）
    function observePageChange() {
        let lastUrl = location.href;
        
        const observer = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                console.log(`${LOG_PREFIX} 检测到页面切换`);
                
                // 延迟执行以等待新页面加载
                setTimeout(() => {
                    console.log(`${LOG_PREFIX} 重新初始化脚本`);
                    initializeScript();
                }, 1000);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // 初始化脚本
    function initializeScript() {
        console.log(`${LOG_PREFIX} 初始化音量自定义脚本...`);
        
        waitForCreatorId((creatorId) => {
            console.log(`${LOG_PREFIX} 当前UP主ID: ${creatorId}`);
            applyVolumeSettings(creatorId);
            monitorVolumeChange(creatorId);
        });
    }

    // 启动脚本
    initializeScript();
    observePageChange();

})();