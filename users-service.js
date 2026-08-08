// 使用者與角色資料存取層。
// Firebase Auth 前端 SDK 沒辦法列出全部帳號（那要後端 Admin SDK），
// 所以改用「每次登入都順便把自己的 email 寫進 users/{uid}」的方式，
// 讓管理員能看到的名單 = 曾經登入過的帳號，再由管理員勾選角色。

import { db } from './firebase-config.js?v=13';
import {
  collection,
  onSnapshot,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const usersCol = collection(db, 'users');

// 登入時呼叫：確保自己的 profile 文件存在、更新最後登入時間。
// 用 merge，不會動到管理員已經設定好的 roles 欄位。
export async function touchOwnProfile(uid, email) {
  await setDoc(doc(db, 'users', uid), {
    email,
    lastLoginAt: Date.now()
  }, { merge: true });
}

// 訂閱自己的角色設定：管理員改了角色之後，畫面不用重新登入就會跟著變。
export function subscribeToOwnProfile(uid, callback, onError) {
  return onSnapshot(
    doc(db, 'users', uid),
    snap => callback(snap.exists() ? snap.data() : { roles: [] }),
    onError
  );
}

export function subscribeToUsers(callback, onError) {
  return onSnapshot(
    usersCol,
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export async function updateUserRoles(uid, roles) {
  await setDoc(doc(db, 'users', uid), { roles }, { merge: true });
}
