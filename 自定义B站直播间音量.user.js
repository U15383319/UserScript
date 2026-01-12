// ==UserScript==
// @name         自定义B站直播间音量
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  为不同直播间单独保存音量设置
// @author       果冻大神
// @match        https://live.bilibili.com/*
// @icon         https://live.bilibili.com/favicon.ico
// @grant        none
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/503944/%E8%87%AA%E5%AE%9A%E4%B9%89B%E7%AB%99%E7%9B%B4%E6%92%AD%E9%97%B4%E9%9F%B3%E9%87%8F.user.js
// @updateURL https://update.greasyfork.org/scripts/503944/%E8%87%AA%E5%AE%9A%E4%B9%89B%E7%AB%99%E7%9B%B4%E6%92%AD%E9%97%B4%E9%9F%B3%E9%87%8F.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // 获取并返回保存的音量设置，若没有则返回默认音量 50%
    function getSavedVolume(roomId) {
        return parseFloat(localStorage.getItem(`volume-${roomId}`)) || 0.33; // 默认音量 33%
    }

    // 保存音量设置
    function saveVolume(roomId, volume) {
        localStorage.setItem(`volume-${roomId}`, volume);
    }

    // 设置指定父元素下所有视频元素的音量
    function setVolumeForVideos(parentSelector, volume) {
        const parentElement = document.querySelector(parentSelector);
        if (parentElement) {
            const videos = parentElement.querySelectorAll("video");
            videos.forEach(video => {
                video.volume = volume;
            });
            console.log(`音量设置为 ${volume * 100}%`);
            return true;
        } else {
            console.log(`未找到选择器为 ${parentSelector} 的父元素。`);
            return false;
        }
    }

    // 获取当前直播间的房间 ID
    function getRoomIdentifier() {
        const url = window.location.href;
        const match = url.match(/live\.bilibili\.com\/(?:blanc\/)?(\d+)/);
        return match ? match[1] : null; // 提取房间ID
    }


    // 监听指定元素的高度变化并根据高度设置音量
    function monitorHeightChange(selector, parentSelector) {
        const targetElement = document.querySelector(selector);
        if (!targetElement) {
            console.error(`未找到选择器为 ${selector} 的目标元素。`);
            return;
        }

        let previousHeight = targetElement.style.height;
        const roomId = getRoomIdentifier();

        if (!roomId) {
            console.error("未找到房间号。");
            return;
        }


        const customVolume = getSavedVolume(roomId);

        // 更新音量设置
        function updateVolume() {
            const currentHeight = targetElement.style.height;
            if (currentHeight !== previousHeight) {
                previousHeight = currentHeight;

                // 解析并转换高度值为音量
                const heightPercent = parseFloat(currentHeight);
                if (!isNaN(heightPercent)) {
                    const volume = heightPercent / 100; // 假设高度是百分比

                    setVolumeForVideos(parentSelector, volume);
                    saveVolume(roomId, volume);
                    console.log(`高度变化，音量更新为 ${volume * 100}%`);
                } else {
                    console.error("无法解析高度值。");
                }
            }
        }

        // 使用 MutationObserver 监听 style.height 的变化
        const observer = new MutationObserver(updateVolume);
        observer.observe(targetElement, { attributes: true, attributeFilter: ['style'] });

        // 初始化音量设置
        updateVolume();
    }

        // 检测视频源切换并重新设置音量
    function detectSourceChangeAndSetVolume(parentSelector) {
        let lastPlayUrl = null;

        function checkForSourceChange() {
            const playerInfo = window.livePlayer?.getPlayerInfo();
            if (playerInfo) {
                const currentPlayUrl = playerInfo.playurl;
                if (currentPlayUrl !== lastPlayUrl) {
                    lastPlayUrl = currentPlayUrl;
                    const roomId = getRoomIdentifier();
                    if (roomId) {
                        const savedVolume = getSavedVolume(roomId);
                        setVolumeForVideos(parentSelector, savedVolume);
                        console.log(`检测到视频源切换，重新设置音量为 ${savedVolume * 100}%`);
                    }
                }
            }
        }

        setInterval(checkForSourceChange, 1000); // 每秒检查一次
    }

    // 等待房间 ID 可用时执行回调
    function waitForRoomIdentifier(callback) {
        const interval = setInterval(() => {
            const roomId = getRoomIdentifier();
            if (roomId) {
                clearInterval(interval);
                callback(roomId);
            }
        }, 1000); // 每秒检查一次
    }

    // 应用音量设置并检查 10 秒
    function applyVolumeSettings(parentSelector, duration) {
        const roomId = getRoomIdentifier();
        console.log(`房间号为 ${roomId}`);
        if (!roomId) {
            console.error("未找到房间标识符。");
            return;
        }

        const savedVolume = parseFloat(getSavedVolume(roomId));
        const endTime = Date.now() + duration;
        const interval = 1000;

        const timer = setInterval(() => {
            const found = setVolumeForVideos(parentSelector, savedVolume);

            if (found) {
                clearInterval(timer);
            }

            if (Date.now() > endTime) {
                clearInterval(timer);
            }
        }, interval);
    }

    // 设置鼠标悬停监听器以监控高度变化
    function setupHoverListener(playbackSelector, volumeControlSelector, monitorSelector, parentSelector) {
        const playbackElement = document.querySelector(playbackSelector);
        if (!playbackElement) {
            console.error(`未找到选择器为 ${playbackSelector} 的播放区域元素。`);
            return;
        }

        playbackElement.addEventListener('mouseenter', () => {
            console.log('鼠标进入播放区域。');

            setTimeout(() => {
                // 监听音量控制元素的鼠标悬停
                const volumeControlElement = document.querySelector(volumeControlSelector);
                if (!volumeControlElement) {
                    console.error(`未找到选择器为 ${volumeControlSelector} 的音量控制元素。`);
                    return;
                }

                volumeControlElement.addEventListener('mouseenter', () => {
                    console.log('鼠标进入音量控制区域。开始监听高度变化。');
                    setTimeout(() => {
                        monitorHeightChange(monitorSelector, parentSelector);
                    }, 100);
                });
            }, 100);
        });
    }

    // 启动程序，等待房间 ID 可用并设置监听器
    waitForRoomIdentifier(() => {
        setupHoverListener("#live-player", "#web-player-controller-wrap-el > div > div > div.left-area.svelte-4rgwwa > div.volume.svelte-qk4eah","#web-player-controller-wrap-el > div > div > div.left-area.svelte-4rgwwa > div.volume.svelte-qk4eah > div > div > div.slider-rail.svelte-crc1ty > div.slider-track.svelte-crc1ty.height-trans", "#live-player");
        applyVolumeSettings("#live-player", 10000);
        detectSourceChangeAndSetVolume("#live-player");
    });

})();
