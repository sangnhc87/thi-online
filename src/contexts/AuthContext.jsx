import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { buildUserSearchFields } from '../utils/search';
import { hasTeacherWorkspaceAccess, isTeacherPaidPlan as hasPaidTeacherPlan } from '../utils/teacherPlan';

const AuthContext = createContext(null);
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || '';

export function useAuth() {
    return useContext(AuthContext);
}

function generateSlug(name) {
    return (name || 'user')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 40);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    async function getOrCreateProfile(firebaseUser) {
        const ref = doc(db, 'users', firebaseUser.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
            const profile = { uid: firebaseUser.uid, ...snap.data() };
            // Auto-promote to admin if matching env email (case-insensitive)
            if (ADMIN_EMAIL && firebaseUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() && profile.role !== 'admin') {
                await updateDoc(ref, { role: 'admin' });
                profile.role = 'admin';
            }
            return profile;
        }

        // New user
        const isAdmin = ADMIN_EMAIL && firebaseUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
        const newProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            role: isAdmin ? 'admin' : 'student',
            // Student fields
            teacherId: null,
            teacherName: null,
            // Stats
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
            ...buildUserSearchFields({
                email: firebaseUser.email,
                displayName: firebaseUser.displayName,
            }),
        };
        await setDoc(ref, newProfile);
        return newProfile;
    }

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

    const refreshProfile = useCallback(async () => {
        if (!user) return null;
        const ref = doc(db, 'users', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
            const profile = { uid: user.uid, ...snap.data() };
            // Auto-promote admin on refresh too
            if (ADMIN_EMAIL && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() && profile.role !== 'admin') {
                await updateDoc(ref, { role: 'admin' });
                profile.role = 'admin';
            }
            setUserProfile(profile);
            return profile;
        }
        return null;
    }, [user]);

    const signInWithGoogle = async () => {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        return result;
    };
    const logout = () => signOut(auth);

    // Teacher plan helpers
    const isSubscriptionActive = () => hasTeacherWorkspaceAccess(userProfile);
    const isPaidTeacherPlan = () => hasPaidTeacherPlan(userProfile);

    const value = {
        user,
        userProfile,
        loading,
        signInWithGoogle,
        login: signInWithGoogle,
        logout,
        refreshProfile,
        isTeacher: userProfile?.role === 'teacher' || userProfile?.role === 'admin',
        isAdmin: userProfile?.role === 'admin',
        isSubscriptionActive,
        isPaidTeacherPlan,
        generateSlug,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
