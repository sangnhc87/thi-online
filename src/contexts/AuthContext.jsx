import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';

const AuthContext = createContext(null);

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);
                const profile = await getOrCreateProfile(firebaseUser);
                setUserProfile(profile);
            } else {
                setUser(null);
                setUserProfile(null);
            }
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    const getOrCreateProfile = async (firebaseUser) => {
        const ref = doc(db, 'users', firebaseUser.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
            return { uid: firebaseUser.uid, ...snap.data() };
        }
        // New user → default role is "student"
        const newProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            role: 'student',
            streak: 0,
            maxStreak: 0,
            totalQuizzes: 0,
            totalScore: 0,
            totalQuestions: 0,
            perfectScores: 0,
            speedFinishes: 0,
            achievements: [],
            lastActiveDate: '',
            createdAt: Timestamp.now(),
        };
        await setDoc(ref, newProfile);
        return newProfile;
    };

    const signInWithGoogle = async () => {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        return result;
    };
    const logout = () => signOut(auth);

    const value = {
        user,
        userProfile,
        loading,
        signInWithGoogle,
        login: signInWithGoogle,
        logout,
        isTeacher: userProfile?.role === 'teacher' || userProfile?.role === 'admin',
        isAdmin: userProfile?.role === 'admin',
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
