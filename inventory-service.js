// 庫存資料存取層：讀寫 Firestore 的 stock collection。
// 一筆文件 = 一個品項在一個倉庫的庫存現況（品號 + 倉庫 唯一決定一筆）。

import { db } from './firebase-config.js?v=1';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  writeBatch,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const stockCol = collection(db, 'stock');

function stockDocId(itemCode, warehouse) {
  return `${itemCode}__${warehouse}`;
}

export function subscribeToStock(callback, onError) {
  return onSnapshot(
    stockCol,
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// 匯入用：整批覆蓋「這次匯入的倉庫」資料。
// records: [{ itemCode, itemName, warehouse, warehouseLocation, qty, nearestExpiry, note }]
// 同一個倉庫舊資料會被完全取代（品項下架/歸零時，舊的庫存文件也要跟著消失，不能只靠覆蓋殘留）。
export async function replaceStockForWarehouses(records, warehouses) {
  // 1. 先刪掉這些倉庫目前在 Firestore 裡的所有舊資料
  const existingSnap = await getDocs(stockCol);
  const toDelete = existingSnap.docs.filter(d => warehouses.includes(d.data().warehouse));

  const chunks = [];
  const all = [...toDelete];
  while (all.length) chunks.push(all.splice(0, 450));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // 2. 寫入新資料
  const recordChunks = [];
  const remaining = [...records];
  while (remaining.length) recordChunks.push(remaining.splice(0, 450));
  for (const chunk of recordChunks) {
    const batch = writeBatch(db);
    chunk.forEach(r => {
      const ref = doc(db, 'stock', stockDocId(r.itemCode, r.warehouse));
      batch.set(ref, {
        itemCode: r.itemCode,
        itemName: r.itemName,
        warehouse: r.warehouse,
        warehouseLocation: r.warehouseLocation || '',
        qty: r.qty || 0,
        nearestExpiry: r.nearestExpiry || null,
        note: r.note || '',
        updatedAt: Date.now()
      });
    });
    await batch.commit();
  }

  return { deleted: toDelete.length, written: records.length };
}

export async function updateStockNote(itemCode, warehouse, note) {
  const ref = doc(db, 'stock', stockDocId(itemCode, warehouse));
  await setDoc(ref, { note }, { merge: true });
}
