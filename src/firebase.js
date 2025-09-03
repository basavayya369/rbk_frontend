// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDdYLhcF1GSoygHxcP0ZxQRSJl9wgE4ktg",
  authDomain: "rbk-insight.firebaseapp.com",
  projectId: "rbk-insight",
  storageBucket: "rbk-insight.firebasestorage.app",
  messagingSenderId: "720383243620",
  appId: "1:720383243620:web:bc98afad0d86be00b67671",
  measurementId: "G-9N1NQCZ2HN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);