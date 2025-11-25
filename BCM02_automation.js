/**
 * BCM 全流程整合自動化腳本 V4.0 (循環處理 + 自動關閉回列表版)
 * * 更新內容：
 * 1. [循環] BCM02-2 加入 while 迴圈，處理完一位客戶後自動找下一位。
 * 2. [關閉] BCM04-5 完成後，依序關閉「互動紀錄查詢」與「客戶首頁」。
 * 3. [防呆] 增加 processedNames Set，避免重複處理同一人。
 * 4. [結束] 無客戶時顯示指定提示訊息。
 */
(async function bcmLoopAutomation() {
    console.log("🚀 BCM 全流程自動化腳本 V4.0 (循環處理版) 啟動...");

    // 用來記錄已處理過的客戶姓名，避免重複點擊
    const processedNames = new Set();

    // ==========================================
    // [核心工具區]
    // ==========================================
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function isVisible(elem) {
        return !!(elem && (elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length));
    }

    // 等待元素
    async function waitForElement(xpath, timeout = 10000) {
        let startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            let result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            let element = result.singleNodeValue;
            if (isVisible(element)) return element;
            await sleep(500);
        }
        return null;
    }

    // 強力點擊
    async function forceClick(element) {
        if (!element) return;
        if (element.hasAttribute('disabled')) {
            element.removeAttribute('disabled');
            element.classList.remove('disabled');
            element.disabled = false;
            await sleep(50);
        }
        try { element.scrollIntoView({ behavior: "auto", block: "center" }); } catch (e) { }
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        element.click();
        await sleep(300);
    }

    // [新增] 通用關閉視窗函式
    function closeTopModal() {
        // 搜尋常見的關閉按鈕樣式 (Bootstrap, jQuery UI, Angular)
        let closeBtns = Array.from(document.querySelectorAll('button.close, .ngdialog-close, button[title="Close"], span.ui-icon-closethick, .ui-dialog-titlebar-close'));
        // 過濾出可見的按鈕
        let visibleBtns = closeBtns.filter(b => isVisible(b));

        if (visibleBtns.length > 0) {
            // 通常最後一個是最上層的視窗
            console.log("   [系統] 偵測到關閉按鈕，嘗試關閉視窗...");
            visibleBtns[visibleBtns.length - 1].click();
        } else {
            // 如果找不到按鈕，嘗試發送 ESC 鍵
            console.log("   [系統] 找不到關閉按鈕，嘗試送出 ESC 鍵...");
            document.dispatchEvent(new KeyboardEvent('keydown', { 'keyCode': 27, 'which': 27, 'key': 'Escape', 'bubbles': true }));
        }
    }

    // ==========================================
    // [BCM04-5 下拉選單工具]
    // ==========================================
    function findDropdownButton(labelText) {
        const xpath = `//*[contains(text(), '${labelText}') and not(self::script)]`;
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
            let labelEl = result.snapshotItem(i);
            if (!isVisible(labelEl)) continue;
            let container = labelEl.parentElement;
            let foundBtn = null;
            for (let depth = 0; depth < 5; depth++) {
                if (!container) break;
                const buttons = container.querySelectorAll('.custom-combobox-toggle');
                if (buttons.length > 0) {
                    for (let btn of buttons) {
                        if (labelEl.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) {
                            foundBtn = btn; break;
                        }
                    }
                }
                if (foundBtn) break;
                container = container.parentElement;
            }
            if (foundBtn) return foundBtn;
        }
        return null;
    }

    async function selectCustomCombobox(labelText, targetIndex) {
        console.log(`   [填寫] 設定：${labelText}`);
        const toggleBtn = findDropdownButton(labelText);
        if (!toggleBtn) return; // 容錯
        await forceClick(toggleBtn);

        let visibleMenu = null;
        for (let i = 0; i < 10; i++) {
            const menus = document.querySelectorAll('ul.ui-autocomplete');
            for (let menu of menus) { if (isVisible(menu)) { visibleMenu = menu; break; } }
            if (visibleMenu) break;
            await sleep(100);
        }
        if (!visibleMenu) { await forceClick(toggleBtn); return; }

        const options = visibleMenu.querySelectorAll('li.ui-menu-item a, li.ui-menu-item');
        if (options.length > targetIndex) {
            await forceClick(options[targetIndex]);
        } else {
            await forceClick(toggleBtn);
        }
        await sleep(200);
    }

    async function moveItemToRight(itemPartialText) {
        console.log(`   [填寫] 移動項目：${itemPartialText}`);
        const xpath = `//option[contains(text(), '${itemPartialText}')]`;
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const option = result.singleNodeValue;
        if (!option) return;

        option.selected = true;
        option.parentElement.dispatchEvent(new Event('change', { bubbles: true }));
        try { angular.element(option.parentElement).triggerHandler('change'); } catch (e) { }
        await sleep(300);

        let container = option.parentElement.parentElement;
        let moveBtn = null;
        for (let i = 0; i < 6; i++) {
            if (!container) break;
            const buttons = container.querySelectorAll('button, a.btn, div.btn');
            for (let btn of buttons) {
                const txt = btn.innerText.trim();
                if ((txt === '>' || txt === '›' || btn.innerHTML.includes('ui-icon') || btn.innerHTML.includes('glyphicon')) && isVisible(btn)) {
                    moveBtn = btn; break;
                }
            }
            if (moveBtn) break;
            container = container.parentElement;
        }
        if (moveBtn) await forceClick(moveBtn);
    }

    // ==========================================
    // [主流程邏輯]
    // ==========================================

    try {
        // --- 步驟 1: BCM02-1 列表搜尋 (只做一次) ---
        console.log("步驟 1: 搜尋 [本月未檢視戶數]...");
        let targetFound = false;

        let headerSnapshot = document.evaluate("//th[contains(text(), '本月未檢視戶數')] | //td[contains(text(), '本月未檢視戶數')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (headerSnapshot.snapshotLength === 0) throw new Error("找不到列表標題");
        let headerCell = headerSnapshot.snapshotItem(0);
        let table = headerCell.closest('table');
        let targetColIndex = headerCell.cellIndex;
        let rows = table.querySelectorAll('tbody tr');
        if (rows.length === 0) rows = table.querySelectorAll('tr');

        for (let i = 0; i < rows.length; i++) {
            let row = rows[i];
            let cells = row.cells;
            if (cells.length <= targetColIndex) continue;
            let num = parseInt(cells[targetColIndex].innerText.trim(), 10);
            if (!isNaN(num) && num !== 0) {
                console.log(`   ✅ 找到待處理項目 (數值: ${num})`);
                let link = cells[targetColIndex].querySelector('a');
                await forceClick(link || cells[targetColIndex]);
                targetFound = true;
                break;
            }
        }
        if (!targetFound) {
            alert("努力做完乙仔半套的自動化簽核報表小程式已完成！");
            return;
        }

        await sleep(3000); // 等待進入 BCM02-2

        // --- 步驟 2 ~ 6: 循環處理客戶 ---

        while (true) {
            console.log("-----------------------------------------");
            console.log("步驟 2: [BCM02-2] 掃描客戶列表...");

            // 每次循環重新抓取表格 (避免 DOM 參考遺失)
            let detailTable = await waitForElement("//table[contains(., '客戶姓名')]", 5000);
            if (!detailTable) {
                console.warn("找不到客戶列表，假設已完成。");
                break;
            }

            // 尋找客戶姓名欄位 Index
            let nameColIndex = -1;
            const detailHeaders = detailTable.querySelectorAll('th, thead td, tr.grid-header td');
            for (let i = 0; i < detailHeaders.length; i++) {
                if (detailHeaders[i].innerText.includes('客戶姓名')) {
                    nameColIndex = i; break;
                }
            }
            if (nameColIndex === -1) nameColIndex = 3; // 預設第4欄

            // 尋找尚未處理的第一個客戶
            let clientRows = detailTable.querySelectorAll('tbody tr');
            if (clientRows.length === 0) {
                // 嘗試抓 tr 排除 th
                let allTr = detailTable.querySelectorAll('tr');
                let validTrs = [];
                for (let r of allTr) if (r.querySelectorAll('th').length === 0) validTrs.push(r);
                clientRows = validTrs;
            }

            let targetClientRow = null;
            let targetClientName = "";

            for (let row of clientRows) {
                if (row.cells.length <= nameColIndex) continue;

                let cell = row.cells[nameColIndex];
                let name = cell.innerText.trim();

                // 檢查是否已處理過
                if (!processedNames.has(name) && name.length > 0) {
                    targetClientRow = row;
                    targetClientName = name;
                    break; // 找到第一個未處理的就跳出
                }
            }

            if (!targetClientRow) {
                // 找不到任何未處理的客戶 -> 結束
                console.log("✅ 列表中已無未處理客戶。");
                alert("乙仔努力做完半套的自動化簽核報表小程式已完成！");
                break;
            }

            // --- 開始處理該客戶 ---
            console.log(`   -> 鎖定客戶：${targetClientName}`);
            let clientLink = targetClientRow.cells[nameColIndex].querySelector('a');
            await forceClick(clientLink || targetClientRow.cells[nameColIndex]);

            await sleep(3000); // 等待 BCM02-3

            // --- 步驟 3: BCM02-3 點更多 ---
            console.log("步驟 3: [客戶首頁] 點選更多...");
            let moreBtn = document.querySelector("a[ng-click*='toCHSAM120']");
            if (!moreBtn) moreBtn = await waitForElement("//a[contains(text(), '更多')]", 3000);

            if (moreBtn) {
                let executed = false;
                if (typeof angular !== 'undefined') {
                    try {
                        let scope = angular.element(moreBtn).scope();
                        if (scope && scope.toCHSAM120) {
                            scope.$apply(() => scope.toCHSAM120('CHSAM120'));
                            executed = true;
                        }
                    } catch (e) { }
                }
                if (!executed) await forceClick(moreBtn);
            } else {
                console.error("❌ 找不到 [更多] 按鈕，跳過此客戶");
                processedNames.add(targetClientName);
                closeTopModal(); await sleep(1000);
                continue; // 嘗試下一個
            }

            await sleep(3000); // 等待 BCM02-4

            // --- 步驟 4: BCM02-4 點新增 ---
            console.log("步驟 4: [互動紀錄] 點選新增...");
            let btnAdd = await waitForElement("//button[contains(text(), '新增')]", 5000);
            if (btnAdd) {
                await forceClick(btnAdd);
            } else {
                console.error("❌ 找不到 [新增] 按鈕，跳過此客戶");
                processedNames.add(targetClientName);
                closeTopModal(); await sleep(500); // 關閉互動紀錄
                closeTopModal(); await sleep(1000); // 關閉客戶首頁
                continue;
            }

            // --- 步驟 5: BCM04-5 自動填寫 ---
            console.log("步驟 5: [填寫表單] 自動填寫中...");
            let formReady = await waitForElement("//*[contains(text(), '客戶來源')]", 5000);
            if (formReady) {
                await sleep(1000);
                try {
                    await selectCustomCombobox("客戶來源", 1);
                    await selectCustomCombobox("聯繫管道", 1);
                    await selectCustomCombobox("聯繫結果", 1);
                    await selectCustomCombobox("聯繫花費時間", 1);
                    await moveItemToRight("定期檢視淨值管理效益");

                    // --- 步驟 6: 送出 ---
                    let btnConfirm = await waitForElement("//button[contains(text(), '確定')]", 3000);
                    if (btnConfirm) {
                        await forceClick(btnConfirm);
                        console.log("[成功]已點擊確定，流程結束!");

                        // 標記為已處理
                        processedNames.add(targetClientName);

                        // --- 步驟 7: 關閉視窗 (關鍵邏輯) ---
                        // 等待一下，讓確定按鈕的效果執行完 (例如存檔)
                        await sleep(2000);

                        console.log("   -> 關閉 BCM02-4「互動紀錄查詢」");
                        closeTopModal();

                        await sleep(1000); // 等待視窗動畫

                        console.log("   -> 關閉 BCM02-3「客戶首頁」");
                        closeTopModal();

                        await sleep(1500); // 等待回到 BCM02-2 列表

                    } else {
                        throw new Error("找不到確定按鈕");
                    }
                } catch (e) {
                    console.error("表單填寫失敗:", e);
                    processedNames.add(targetClientName); // 避免卡死，也將其視為處理過
                    closeTopModal(); await sleep(500);
                    closeTopModal(); await sleep(500);
                    closeTopModal(); await sleep(1000);
                }
            } else {
                console.error("表單未開啟");
                processedNames.add(targetClientName);
                closeTopModal(); await sleep(500);
                closeTopModal(); await sleep(1000);
            }
            // 迴圈繼續，回到 BCM02-2 重新掃描
        }

    } catch (err) {
        console.error("❌ 執行錯誤:", err);
        alert("程式執行中斷：" + err.message);
    }
})();