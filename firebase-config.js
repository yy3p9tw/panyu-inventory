// Firebase 專案設定：panyu-inventory（跟產品目錄是不同的 Firebase 專案，資料分開）
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCkcL_8DdyQyfuuYwNbFg4cJeugXeJb77g",
  authDomain: "panyu-inventory.firebaseapp.com",
  projectId: "panyu-inventory",
  storageBucket: "panyu-inventory.firebasestorage.app",
  messagingSenderId: "975160270709",
  appId: "1:975160270709:web:0ca1dd5c40cb564ea83d3c"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
