/**
 * BCM02 全流程整合自動化腳本 V5.2 (聚焦重試修正版)
 * 修正項目：
 * 1. [針對 CUST_ID 錯誤] 在點擊「更多」前先執行 focus()，確保資料 context 正確。
 * 2. [重試機制] 若點擊後未出現「新增」按鈕，會等待 2 秒後再次嘗試點擊 (最多 3 次)。
 * 3. [架構] 維持雙層迴圈 (儀表板 -> 客戶列表 -> 儀表板) 自動化流程。
 */
(async function bcmAutomationV5_2() {
    console.log("🚀 BCM02 全流程自動化腳本 V5.2 (聚焦重試修正版) 啟動...");
    
    const processedNames = new Set(); // 記錄已處理名單

    // ==========================================
    // [核心工具區]
    // ==========================================
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function isVisible(elem) {
        return !!(elem && (elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length));
    }

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

    // 標準強力點擊 (用於一般按鈕)
    async function forceClick(element) {
        if (!element) return;
        if (element.hasAttribute('disabled')) {
            element.removeAttribute('disabled');
            element.classList.remove('disabled');
            element.disabled = false;
            await sleep(50);
        }
        try { element.scrollIntoView({behavior: "auto", block: "center"}); } catch(e) {}
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        element.click();
        await sleep(500);
    }

    function closeTopModal() {
        let closeBtns = Array.from(document.querySelectorAll('button.close, .ngdialog-close, button[title="Close"], span.ui-icon-closethick, .ui-dialog-titlebar-close'));
        let visibleBtns = closeBtns.filter(b => isVisible(b));
        if (visibleBtns.length > 0) {
            visibleBtns[visibleBtns.length - 1].click();
        } else {
            document.dispatchEvent(new KeyboardEvent('keydown', {'keyCode': 27, 'which': 27, 'key': 'Escape', 'bubbles': true}));
        }
    }

    // ==========================================
    // [表單填寫工具]
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
        if (!toggleBtn) return;
        await forceClick(toggleBtn);
        
        let visibleMenu = null;
        for(let i=0; i<10; i++) {
            const menus = document.querySelectorAll('ul.ui-autocomplete');
            for(let menu of menus) { if (isVisible(menu)) { visibleMenu = menu; break; } }
            if(visibleMenu) break;
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
        try { angular.element(option.parentElement).triggerHandler('change'); } catch(e){}
        await sleep(300);
        
        let container = option.parentElement.parentElement;
        let moveBtn = null;
        for(let i=0; i<6; i++) {
            if(!container) break;
            const buttons = container.querySelectorAll('button, a.btn, div.btn');
            for(let btn of buttons) {
                const txt = btn.innerText.trim();
                if ((txt === '>' || txt === '›' || btn.innerHTML.includes('ui-icon') || btn.innerHTML.includes('glyphicon')) && isVisible(btn)) {
                    moveBtn = btn; break;
                }
            }
            if(moveBtn) break;
            container = container.parentElement;
        }
        if (moveBtn) await forceClick(moveBtn);
    }

    // ==========================================
    // [主流程]
    // ==========================================

    try {
        // --- 外層迴圈 ---
        while (true) {
            console.log("=========================================");
            console.log("外層迴圈: 搜尋 BCM02-1 未檢視戶數...");
            await sleep(1000);

            let dashboardTargetFound = false;
            let headerSnapshot = document.evaluate("//th[contains(text(), '本月未檢視戶數')] | //td[contains(text(), '本月未檢視戶數')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            
            if (headerSnapshot.snapshotLength > 0) {
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
                        let link = cells[targetColIndex].querySelector('a');
                        if (link) {
                            console.log(`   ✅ 發現待處理項目 (數量: ${num})`);
                            await forceClick(link);
                            dashboardTargetFound = true;
                            break; 
                        }
                    }
                }
            } else {
                console.warn("   ⚠️ 找不到儀表板表格 (可能已進入內層或頁面未載入)");
            }

            if (!dashboardTargetFound) {
                console.log("🎉 任務完成：已無待處理項目。");
                alert("乙仔努力做完半套的自動化簽核報表已完成！");
                break; 
            }

            await sleep(3000); 

            // --- 內層迴圈 (客戶列表) ---
            while (true) {
                console.log("-----------------------------------------");
                console.log("內層迴圈: 掃描 BCM02-2 客戶列表...");

                let detailTable = await waitForElement("//table[contains(., '客戶姓名')]", 5000);
                if (!detailTable) {
                    console.log("   ℹ️ 客戶列表已關閉或處理完畢，回到外層。");
                    break;
                }

                let nameColIndex = -1;
                const detailHeaders = detailTable.querySelectorAll('th, thead td, tr.grid-header td');
                for (let i = 0; i < detailHeaders.length; i++) {
                    if (detailHeaders[i].innerText.includes('客戶姓名')) {
                        nameColIndex = i; break;
                    }
                }
                if (nameColIndex === -1) nameColIndex = 3;

                let clientRows = detailTable.querySelectorAll('tbody tr');
                if (clientRows.length === 0) {
                     let allTr = detailTable.querySelectorAll('tr');
                     let validTrs = [];
                     for(let r of allTr) if(r.querySelectorAll('th').length === 0) validTrs.push(r);
                     clientRows = validTrs;
                }

                let targetClientRow = null;
                let targetClientName = "";

                for (let row of clientRows) {
                    if (row.cells.length <= nameColIndex) continue;
                    let name = row.cells[nameColIndex].innerText.trim();
                    if (!processedNames.has(name) && name.length > 0) {
                        targetClientRow = row;
                        targetClientName = name;
                        break; 
                    }
                }

                if (!targetClientRow) {
                    console.log("   ✅ 此分類客戶已全部處理完畢。");
                    break; // 跳出內層，去關閉視窗
                }

                console.log(`   -> 鎖定客戶：${targetClientName}`);
                let clientLink = targetClientRow.cells[nameColIndex].querySelector('a');
                await forceClick(clientLink || targetClientRow.cells[nameColIndex]);

                console.log("   -> 等待客戶首頁資料載入 (約 5 秒)...");
                await sleep(5000); 

                // --- 步驟 3: 點選 [更多] (重試機制) ---
                console.log("   -> [步驟 3] 尋找 [更多] 按鈕並嘗試點擊...");
                let moreBtn = document.querySelector("a[ng-click*='toCHSAM120']");
                if (!moreBtn) moreBtn = await waitForElement("//a[contains(text(), '更多')]", 3000);

                let isMenuOpened = false;
                
                if (moreBtn) {
                    // 最多重試 3 次
                    for (let retry = 1; retry <= 3; retry++) {
                        try {
                            console.log(`      -> 第 ${retry} 次嘗試點擊...`);
                            
                            // [關鍵修正]: 先 Focus 確保 Angular 知道誰是 active
                            moreBtn.focus();
                            moreBtn.dispatchEvent(new Event('focus')); 
                            await sleep(500);

                            // 點擊
                            moreBtn.click();
                            
                            // 檢查是否成功打開 (等待新增按鈕出現)
                            let btnAddCheck = await waitForElement("//button[contains(text(), '新增')]", 2000);
                            
                            if (btnAddCheck) {
                                console.log("      -> ✅ 成功打開互動紀錄視窗！");
                                isMenuOpened = true;
                                break; // 成功跳出
                            } else {
                                console.warn("      ⚠️ 點擊後未發現 [新增] 按鈕，可能資料載入中...");
                                await sleep(2000); // 失敗後等待 2 秒再試
                            }
                        } catch (e) {
                            console.error(`      ❌ 點擊發生錯誤: ${e.message}，等待重試...`);
                            await sleep(2000);
                        }
                    }
                } else {
                    console.error("   ❌ 找不到 [更多] 按鈕，跳過。");
                }

                if (!isMenuOpened) {
                    console.error("   ❌ 多次嘗試點擊失敗，跳過此客戶。");
                    processedNames.add(targetClientName);
                    closeTopModal(); await sleep(1000);
                    continue; // 換下一個客戶
                }

                // --- 步驟 4: 點選 [新增] ---
                console.log("   -> [步驟 4] 點選 [新增]...");
                // 此時按鈕應該已經被 check 過存在了，直接抓
                let btnAdd = await waitForElement("//button[contains(text(), '新增')]", 3000);
                
                if (btnAdd) {
                    await forceClick(btnAdd);
                    
                    // --- 步驟 5: BCM04-5 填寫 ---
                    console.log("   -> [步驟 5] 填寫表單...");
                    let formReady = await waitForElement("//*[contains(text(), '客戶來源')]", 5000);
                    if (formReady) {
                        await sleep(1000);
                        try {
                            await selectCustomCombobox("客戶來源", 1);
                            await selectCustomCombobox("聯繫管道", 1);
                            await selectCustomCombobox("聯繫結果", 1);
                            await selectCustomCombobox("聯繫花費時間", 1);
                            await moveItemToRight("定期檢視淨值管理效益");
                            
                            let btnConfirm = await waitForElement("//button[contains(text(), '確定')]", 3000);
                            if (btnConfirm) {
                                await forceClick(btnConfirm);
                                console.log("      [成功] 已點擊確定！");
                                processedNames.add(targetClientName);
                                
                                await sleep(2000); 
                                console.log("      -> 關閉視窗 (互動紀錄)");
                                closeTopModal();
                                await sleep(1000); 
                                console.log("      -> 關閉視窗 (客戶首頁)");
                                closeTopModal();
                                await sleep(1500); 
                            } else {
                                throw new Error("找不到確定按鈕");
                            }
                        } catch (e) {
                            console.error("      ❌ 表單填寫失敗:", e);
                            processedNames.add(targetClientName);
                            closeTopModal(); await sleep(500);
                            closeTopModal(); await sleep(500);
                            closeTopModal(); await sleep(1000);
                        }
                    } else {
                        console.error("      ❌ 表單未開啟");
                        processedNames.add(targetClientName);
                        closeTopModal(); await sleep(500); 
                        closeTopModal(); await sleep(500); 
                        closeTopModal(); await sleep(1000);
                    }
                } else {
                    // 理論上前面 check 過不會進這，但保留防呆
                    processedNames.add(targetClientName);
                    closeTopModal(); await sleep(1000);
                    continue;
                }

            } // End 內層 While

            console.log("內層處理完畢，關閉 BCM02-2 列表...");
            closeTopModal();
            await sleep(2000);

        } // End 外層 While

    } catch (err) {
        console.error("❌ 系統錯誤:", err);
        alert("程式執行中斷：" + err.message);
    }
})();