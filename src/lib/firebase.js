import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Your web app's Firebase configuration
// Replace these with your own Firebase config values
const firebaseConfig = {
  apiKey: "AIzaSyBQkuO6ltmJ8cfJI9B3Wct7QE6Kh0nvl44",
  authDomain: "chocolate-batch-calculator.firebaseapp.com",
  projectId: "chocolate-batch-calculator",
  storageBucket: "chocolate-batch-calculator.firebasestorage.app",
  messagingSenderId: "Y1084846149691",
  appId: "1:1084846149691:web:dc94e0c74818edb9e70c1e",
  measurementId: "G-6HVVMECN6R"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
