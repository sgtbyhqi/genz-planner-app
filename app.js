import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Home, Calendar as CalendarIcon, Target, Brain, BookOpen, BarChart, Clock, Plus, Trash2, Edit, CheckCircle, Flame, Moon, Sun, TrendingUp, X, Check, Droplet, Coffee, ListChecks // 'Checklist' diganti menjadi 'ListChecks'
} from 'lucide-react';

// --- FIREBASE IMPORTS & INITIALIZATION ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, collection, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { setLogLevel } from 'firebase/firestore';

// Atur log level debug untuk Firestore
setLogLevel('debug');

// Global variables (provided by the environment)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Helper function to handle async retries (for API calls like fetch)
const withRetry = async (fn, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const delay = Math.pow(2, i) * 1000;
            console.warn(`Attempt ${i + 1} failed. Retrying in ${delay / 1000}s...`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

// --- DATA STRUCTURES & MOCK DATA (For initial display before data loads) ---

const initialTask = {
    name: "Tugas Skripsi Bab 1",
    category: "Kuliah",
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
    priority: "Penting - Mendesak",
    subtasks: [{ id: crypto.randomUUID(), text: "Cari 5 Jurnal", completed: false }],
    completed: false
};

const initialHabit = {
    name: "Minum 2 liter air",
    streak: 5,
    lastChecked: new Date().toISOString().split('T')[0],
    target: 7, // Target days per week
    checkedToday: false
};

const initialRoutine = {
    time: "05:00 - 09:00",
    category: "PAGI",
    color: "bg-pink-100",
    activities: [
        { id: 'p1', text: "Bangun tidur & merapikan tempat tidur", checked: false },
        { id: 'p2', text: "Minum air putih", checked: false },
        { id: 'p3', text: "Sholat Subuh (jika Muslim)", checked: false },
        { id: 'p4', text: "Journaling singkat (3 hal disyukuri, 3 target)", checked: false },
        { id: 'p5', text: "Sarapan sehat", checked: false },
        { id: 'p6', text: "Mulai tugas penting (deep work)", checked: false },
    ]
};

const initialLibraryItem = {
    title: "Atomic Habits",
    author: "James Clear",
    currentPage: 150,
    totalPages: 320,
    highlight: "Kebiasaan kecil menghasilkan perubahan besar.",
    reflection: "Fokus pada sistem, bukan tujuan."
};


// --- FIREBASE HOOKS & CONTEXT (Simplified for single file) ---
function useFirebase() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    useEffect(() => {
        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Firebase config is missing.");
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
            setDb(dbInstance);
            setAuth(authInstance);

            const unsubscribe = onAuthStateChanged(authInstance, (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    // Sign in anonymously if no token is provided or if user logs out
                    signInAnonymously(authInstance).then(anonUser => {
                        setUserId(anonUser.user.uid);
                    }).catch(error => {
                        console.error("Anonymous sign-in failed:", error);
                    }).finally(() => {
                        setIsAuthReady(true);
                    });
                }
            });

            // Use custom token for secure sign-in if available
            if (initialAuthToken) {
                signInWithCustomToken(authInstance, initialAuthToken).then(userCredential => {
                    console.log("Signed in with custom token.");
                    setUserId(userCredential.user.uid);
                }).catch(error => {
                    console.error("Custom token sign-in failed, trying anonymous:", error);
                    signInAnonymously(authInstance);
                }).finally(() => {
                    setIsAuthReady(true);
                });
            } else if (!initialAuthToken && !authInstance.currentUser) {
                // If no token, and not already signed in, initiate anonymous sign-in
                signInAnonymously(authInstance).finally(() => {
                    setIsAuthReady(true);
                });
            }

            return () => unsubscribe();
        } catch (e) {
            console.error("Firebase initialization failed:", e);
        }
    }, []);

    return { db, auth, userId, isAuthReady };
}

function useFirestoreCollection(db, userId, collectionName, sortField = null) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!db || !userId) {
            setLoading(false);
            return;
        }

        const path = `artifacts/${appId}/users/${userId}/${collectionName}`;
        const colRef = collection(db, path);
        let q = colRef;

        // NOTE: Firebase queries are sorted client-side to avoid index issues (as per instruction).
        // If necessary, add orderBy(sortField, 'asc') here and ensure index exists in a real environment.

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Client-side sorting
            if (sortField) {
                list.sort((a, b) => {
                    if (a[sortField] < b[sortField]) return -1;
                    if (a[sortField] > b[sortField]) return 1;
                    return 0;
                });
            }

            setData(list);
            setLoading(false);
            setError(null);
        }, (e) => {
            console.error(`Error fetching ${collectionName}:`, e);
            setError(e.message);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, userId, collectionName, sortField]);

    const addData = useCallback(async (item) => {
        if (!db || !userId) return;
        const path = `artifacts/${appId}/users/${userId}/${collectionName}`;
        await addDoc(collection(db, path), item);
    }, [db, userId, collectionName]);

    const updateData = useCallback(async (id, item) => {
        if (!db || !userId) return;
        const path = `artifacts/${appId}/users/${userId}/${collectionName}`;
        const docRef = doc(db, path, id);
        await updateDoc(docRef, item);
    }, [db, userId, collectionName]);

    const deleteData = useCallback(async (id) => {
        if (!db || !userId) return;
        const path = `artifacts/${appId}/users/${userId}/${collectionName}`;
        const docRef = doc(db, path, id);
        await deleteDoc(docRef);
    }, [db, userId, collectionName]);

    return { data, loading, error, addData, updateData, deleteData };
}

// --- UTILITY COMPONENTS ---

// Custom Modal (instead of alert/confirm)
const Modal = ({ isOpen, title, children, onClose, footer }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg transform transition-all scale-100 opacity-100">
                <div className="p-5 border-b flex justify-between items-center">
                    <h3 className="text-xl font-bold text-indigo-700">{title}</h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-5">
                    {children}
                </div>
                {footer && <div className="p-5 border-t">{footer}</div>}
            </div>
        </div>
    );
};

// --- FEATURE COMPONENTS ---

// Component for Adding/Editing Tasks and Habits
const ActionForm = ({ type, initialData = {}, onSubmit, onCancel }) => {
    const isTask = type === 'task';
    const [name, setName] = useState(initialData.name || '');
    const [category, setCategory] = useState(initialData.category || (isTask ? 'Kuliah' : 'Kesehatan'));
    const [deadline, setDeadline] = useState(initialData.deadline || new Date().toISOString().split('T')[0]);
    const [priority, setPriority] = useState(initialData.priority || 'Penting - Mendesak');
    const [target, setTarget] = useState(initialData.target || 7); // For Habit

    const taskCategories = ['Kuliah', 'Kerja', 'Bisnis', 'Konten', 'Pribadi'];
    const habitCategories = ['Kesehatan', 'Pendidikan', 'Spiritual', 'Kreativitas'];
    const priorityOptions = ['Penting - Mendesak', 'Penting - Non-mendesak', 'Non-penting - Mendesak', 'Non-penting - Non-mendesak'];

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isTask) {
            onSubmit({
                name,
                category,
                deadline,
                priority,
                subtasks: initialData.subtasks || [],
                completed: initialData.completed || false
            });
        } else {
            onSubmit({
                name,
                category,
                target,
                streak: initialData.streak || 0,
                lastChecked: initialData.lastChecked || new Date().toISOString().split('T')[0],
                checkedToday: initialData.checkedToday || false
            });
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isTask ? "Nama Tugas" : "Nama Kebiasaan (Contoh: Baca 20 menit)"}
                required
                className="w-full p-3 border-2 border-indigo-200 rounded-lg focus:border-indigo-500 transition shadow-sm"
            />
            <div className="flex space-x-4">
                <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="flex-1 p-3 border-2 border-indigo-200 rounded-lg focus:border-indigo-500 transition shadow-sm bg-white"
                >
                    {(isTask ? taskCategories : habitCategories).map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                    ))}
                </select>
                {isTask ? (
                    <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        className="flex-1 p-3 border-2 border-indigo-200 rounded-lg focus:border-indigo-500 transition shadow-sm bg-white"
                    >
                        {priorityOptions.map(p => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>
                ) : (
                    <div className="flex-1">
                        <label className="text-sm font-medium text-gray-500 block mb-1">Target/Minggu</label>
                        <input
                            type="number"
                            value={target}
                            onChange={(e) => setTarget(Math.max(1, parseInt(e.target.value) || 1))}
                            min="1" max="7"
                            className="w-full p-3 border-2 border-indigo-200 rounded-lg focus:border-indigo-500 transition shadow-sm"
                        />
                    </div>
                )}
            </div>

            {isTask && (
                <div>
                    <label className="text-sm font-medium text-gray-500 block mb-1">Deadline</label>
                    <input
                        type="date"
                        value={deadline}
                        onChange={(e) => setDeadline(e.target.value)}
                        className="w-full p-3 border-2 border-indigo-200 rounded-lg focus:border-indigo-500 transition shadow-sm bg-white"
                    />
                </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
                <button
                    type="button"
                    onClick={onCancel}
                    className="py-2 px-4 bg-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-400 transition"
                >
                    Batal
                </button>
                <button
                    type="submit"
                    className="py-2 px-4 bg-indigo-500 text-white font-semibold rounded-lg hover:bg-indigo-600 transition shadow-md shadow-indigo-300/50"
                >
                    {initialData.id ? 'Simpan Perubahan' : 'Tambah Baru'}
                </button>
            </div>
        </form>
    );
};

// Component for Task Manager (C)
const TaskManager = ({ tasks, addTask, updateTask, deleteTask }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState(null);
    const [deleteModal, setDeleteModal] = useState(null);

    const handleOpenModal = (task = null) => {
        setEditingTask(task);
        setIsModalOpen(true);
    };

    const handleSave = (data) => {
        if (editingTask) {
            updateTask(editingTask.id, data);
        } else {
            addTask(data);
        }
        setIsModalOpen(false);
        setEditingTask(null);
    };

    const toggleCompletion = (task) => {
        updateTask(task.id, { completed: !task.completed });
    };

    const getPriorityStyle = (priority) => {
        switch (priority) {
            case 'Penting - Mendesak': return 'bg-red-100 text-red-700 border-red-300';
            case 'Penting - Non-mendesak': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
            case 'Non-penting - Mendesak': return 'bg-blue-100 text-blue-700 border-blue-300';
            default: return 'bg-gray-100 text-gray-700 border-gray-300';
        }
    };

    return (
        <div className="p-6">
            <h1 className="text-3xl font-extrabold text-indigo-800 mb-6 flex items-center">
                <ListChecks className="mr-3" /> Task Manager
            </h1>

            <button
                onClick={() => handleOpenModal()}
                className="mb-6 flex items-center bg-pink-500 text-white py-3 px-6 rounded-xl font-bold shadow-lg shadow-pink-300/50 hover:bg-pink-600 transition transform hover:scale-[1.02]"
            >
                <Plus size={20} className="mr-2" /> Tambah Tugas Baru
            </button>

            <div className="space-y-4">
                {tasks.length === 0 ? (
                    <p className="text-gray-500 italic">Belum ada tugas. Mari tambahkan tugas pertamamu!</p>
                ) : (
                    tasks.map(task => (
                        <div key={task.id} className={`bg-white p-4 rounded-xl shadow-lg border-l-4 ${task.completed ? 'border-green-500 opacity-70' : 'border-indigo-500'} transition hover:shadow-xl`}>
                            <div className="flex items-start justify-between">
                                <div className="flex items-start flex-1 min-w-0">
                                    <button onClick={() => toggleCompletion(task)} className="p-1 mr-3 mt-1">
                                        {task.completed ? (
                                            <CheckCircle className="text-green-500" size={24} fill="currentColor" />
                                        ) : (
                                            <div className="w-6 h-6 border-2 border-indigo-400 rounded-full"></div>
                                        )}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <h3 className={`text-lg font-semibold ${task.completed ? 'line-through text-gray-500' : 'text-indigo-800'}`}>{task.name}</h3>
                                        <p className="text-sm text-gray-600 truncate">Kategori: <span className="font-medium text-indigo-600">{task.category}</span></p>
                                        <div className="flex flex-wrap items-center mt-2 space-x-2 text-xs">
                                            <span className={`px-2 py-1 rounded-full border font-medium ${getPriorityStyle(task.priority)}`}>
                                                {task.priority.split(' - ')[0]}
                                            </span>
                                            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">
                                                Deadline: {task.deadline}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex space-x-2 ml-4">
                                    <button
                                        onClick={() => handleOpenModal(task)}
                                        className="p-2 text-blue-500 hover:bg-blue-50 rounded-full transition"
                                        title="Edit Tugas"
                                    >
                                        <Edit size={18} />
                                    </button>
                                    <button
                                        onClick={() => setDeleteModal(task)}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-full transition"
                                        title="Hapus Tugas"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                            {/* Subtask Section (Mocked) */}
                            {task.subtasks && task.subtasks.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-100 pl-9">
                                    <p className="text-sm font-medium text-indigo-600 mb-1">Subtasks ({task.subtasks.filter(s => s.completed).length}/{task.subtasks.length})</p>
                                    <ul className="text-sm space-y-1">
                                        {task.subtasks.map(sub => (
                                            <li key={sub.id} className={`flex items-center ${sub.completed ? 'line-through text-gray-500' : 'text-gray-700'}`}>
                                                <Check size={14} className="mr-2 text-green-400" /> {sub.text}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            <Modal
                isOpen={isModalOpen}
                title={editingTask ? "Edit Tugas" : "Tambah Tugas Baru"}
                onClose={() => setIsModalOpen(false)}
            >
                <ActionForm
                    type="task"
                    initialData={editingTask || {}}
                    onSubmit={handleSave}
                    onCancel={() => setIsModalOpen(false)}
                />
            </Modal>

            <Modal
                isOpen={!!deleteModal}
                title="Konfirmasi Hapus"
                onClose={() => setDeleteModal(null)}
                footer={
                    <div className="flex justify-end space-x-3">
                        <button
                            onClick={() => setDeleteModal(null)}
                            className="py-2 px-4 bg-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-400 transition"
                        >
                            Batal
                        </button>
                        <button
                            onClick={() => { deleteTask(deleteModal.id); setDeleteModal(null); }}
                            className="py-2 px-4 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition"
                        >
                            Hapus Permanen
                        </button>
                    </div>
                }
            >
                <p>Apakah Anda yakin ingin menghapus tugas **{deleteModal?.name}**?</p>
            </Modal>
        </div>
    );
};

// Component for Habit Tracker (D)
const HabitTracker = ({ habits, addHabit, updateHabit, deleteHabit }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingHabit, setEditingHabit] = useState(null);
    const [deleteModal, setDeleteModal] = useState(null);
    const today = new Date().toISOString().split('T')[0];

    const handleOpenModal = (habit = null) => {
        setEditingHabit(habit);
        setIsModalOpen(true);
    };

    const handleSave = (data) => {
        if (editingHabit) {
            updateHabit(editingHabit.id, data);
        } else {
            // New habit starts today with a 0 streak
            addHabit({ ...data, streak: 0, lastChecked: today, checkedToday: false });
        }
        setIsModalOpen(false);
        setEditingHabit(null);
    };

    const toggleHabit = (habit) => {
        const isChecked = habit.checkedToday;
        let newStreak = habit.streak;
        let newCheckedToday = !isChecked;

        if (newCheckedToday) {
            // User checks the habit
            newStreak = habit.lastChecked === today ? habit.streak : habit.streak + 1;
        } else {
            // User unchecks the habit (only decrement if it was added today)
            // For simplicity, we only allow unchecking for today's entry
            if (habit.lastChecked === today) {
                 newStreak = habit.streak > 0 ? habit.streak - 1 : 0;
            }
        }

        updateHabit(habit.id, {
            checkedToday: newCheckedToday,
            streak: newStreak,
            lastChecked: today
        });
    };

    const getBadge = (streak) => {
        if (streak >= 30) return <span className="text-2xl">👑</span>;
        if (streak >= 7) return <span className="text-xl">⭐</span>;
        if (streak >= 3) return <span className="text-xl">🔥</span>;
        return <span className="text-xl">🌱</span>;
    };

    return (
        <div className="p-6">
            <h1 className="text-3xl font-extrabold text-indigo-800 mb-6 flex items-center">
                <Target className="mr-3" /> Habit Tracker
            </h1>

            <button
                onClick={() => handleOpenModal()}
                className="mb-6 flex items-center bg-green-500 text-white py-3 px-6 rounded-xl font-bold shadow-lg shadow-green-300/50 hover:bg-green-600 transition transform hover:scale-[1.02]"
            >
                <Plus size={20} className="mr-2" /> Tambah Kebiasaan Baru
            </button>

            <div className="space-y-4">
                {habits.length === 0 ? (
                    <p className="text-gray-500 italic">Belum ada kebiasaan yang dilacak.</p>
                ) : (
                    habits.map(habit => (
                        <div key={habit.id} className={`bg-white p-4 rounded-xl shadow-lg border-l-4 ${habit.checkedToday ? 'border-amber-500' : 'border-indigo-500'} transition hover:shadow-xl`}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center flex-1 min-w-0">
                                    <button onClick={() => toggleHabit(habit)} className="p-1 mr-3">
                                        {habit.checkedToday ? (
                                            <Flame className="text-amber-500" size={28} fill="currentColor" />
                                        ) : (
                                            <div className="w-7 h-7 border-2 border-indigo-400 rounded-full"></div>
                                        )}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                        <h3 className={`text-xl font-semibold ${habit.checkedToday ? 'text-amber-700' : 'text-indigo-800'}`}>{habit.name}</h3>
                                        <p className="text-sm text-gray-600">Target: {habit.target}x/minggu</p>
                                    </div>
                                </div>
                                <div className="flex items-center space-x-4">
                                    <div className="flex items-center text-lg font-bold text-gray-700 bg-gray-100 px-3 py-1 rounded-full">
                                        {getBadge(habit.streak)}
                                        <span className="ml-2">{habit.streak}</span>
                                        <span className="ml-1 text-sm font-medium text-gray-500">hari</span>
                                    </div>
                                    <button
                                        onClick={() => handleOpenModal(habit)}
                                        className="p-2 text-blue-500 hover:bg-blue-50 rounded-full transition"
                                        title="Edit Kebiasaan"
                                    >
                                        <Edit size={18} />
                                    </button>
                                    <button
                                        onClick={() => setDeleteModal(habit)}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-full transition"
                                        title="Hapus Kebiasaan"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <Modal
                isOpen={isModalOpen}
                title={editingHabit ? "Edit Kebiasaan" : "Tambah Kebiasaan Baru"}
                onClose={() => setIsModalOpen(false)}
            >
                <ActionForm
                    type="habit"
                    initialData={editingHabit || {}}
                    onSubmit={handleSave}
                    onCancel={() => setIsModalOpen(false)}
                />
            </Modal>

            <Modal
                isOpen={!!deleteModal}
                title="Konfirmasi Hapus"
                onClose={() => setDeleteModal(null)}
                footer={
                    <div className="flex justify-end space-x-3">
                        <button
                            onClick={() => setDeleteModal(null)}
                            className="py-2 px-4 bg-gray-300 text-gray-800 font-semibold rounded-lg hover:bg-gray-400 transition"
                        >
                            Batal
                        </button>
                        <button
                            onClick={() => { deleteHabit(deleteModal.id); setDeleteModal(null); }}
                            className="py-2 px-4 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition"
                        >
                            Hapus Permanen
                        </button>
                    </div>
                }
            >
                <p>Apakah Anda yakin ingin menghapus kebiasaan **{deleteModal?.name}**?</p>
            </Modal>
        </div>
    );
};

// Component for Daily Routine (B)
const DailyRoutine = ({ updateTask, tasks, habits }) => {
    const dailyRoutines = useMemo(() => [
        { ...initialRoutine, time: "05:00 - 09:00", category: "PAGI", icon: <Sun size={20} />, activities: [
            { id: 'p1', text: "Bangun tidur & merapikan tempat tidur", icon: <Check /> },
            { id: 'p2', text: "Minum air putih", icon: <Droplet /> },
            { id: 'p3', text: "Sholat Subuh (jika Muslim)", icon: <Check /> },
            { id: 'p4', text: "Stretching 5 menit", icon: <Check /> },
            { id: 'p5', text: "Journaling singkat", icon: <Check /> },
            { id: 'p6', text: "Sarapan sehat", icon: <Coffee /> },
            { id: 'p7', text: "Baca buku 10–20 menit", icon: <BookOpen /> },
            { id: 'p8', text: "Cek to-do + set prioritas harian", icon: <ListChecks /> },
        ]},
        { ...initialRoutine, time: "09:00 - 13:00", category: "SIANG", icon: <Coffee size={20} />, activities: [
            { id: 's1', text: "Kuliah/tugas utama", icon: <Check /> },
            { id: 's2', text: "Ngerjain project penting", icon: <Check /> },
            { id: 's3', text: "Istirahat 10 menit setiap 1 jam", icon: <Clock /> },
            { id: 's4', text: "Sholat Dzuhur", icon: <Check /> },
            { id: 's5', text: "Makan siang", icon: <Check /> },
        ]},
        { ...initialRoutine, time: "13:00 - 17:00", category: "SORE", icon: <TrendingUp size={20} />, activities: [
            { id: 'r1', text: "Lanjut tugas/kuliah/kerja", icon: <Check /> },
            { id: 'r2', text: "Membuat/mengedit konten", icon: <Check /> },
            { id: 'r3', text: "Sholat Ashar", icon: <Check /> },
            { id: 'r4', text: "Olahraga 15–30 menit", icon: <Target /> },
        ]},
        { ...initialRoutine, time: "19:00 - 22:00", category: "MALAM", icon: <Moon size={20} />, activities: [
            { id: 'n1', text: "Belajar materi kuliah / baca jurnal", icon: <BookOpen /> },
            { id: 'n2', text: "Mengerjakan skripsi atau riset", icon: <Check /> },
            { id: 'n3', text: "Editing konten + menjadwalkan posting", icon: <Check /> },
            { id: 'n4', text: "Persiapan besok", icon: <Check /> },
        ]},
        { ...initialRoutine, time: "22:00 - 23:00", category: "TIDUR", icon: <Brain size={20} />, activities: [
            { id: 'bt1', text: "Journaling malam", icon: <Check /> },
            { id: 'bt2', text: "Meditasi 3–5 menit", icon: <Check /> },
            { id: 'bt3', text: "Tidur sebelum jam 23.00", icon: <Check /> },
        ]},
    ], []);

    // Placeholder state for checking routines (in a real app, this would be stored in Firestore)
    const [checkedState, setCheckedState] = useState(dailyRoutines.map(r => r.activities.map(a => a.id)));

    const handleCheck = (routineIndex, activityId) => {
        setCheckedState(prev => {
            const newState = [...prev];
            const activityIndex = newState[routineIndex].indexOf(activityId);

            if (activityIndex > -1) {
                // Uncheck
                newState[routineIndex].splice(activityIndex, 1);
            } else {
                // Check
                newState[routineIndex].push(activityId);
            }
            return newState;
        });
    };

    return (
        <div className="p-6">
            <h1 className="text-3xl font-extrabold text-indigo-800 mb-6 flex items-center">
                <Clock className="mr-3" /> Daily Routine
            </h1>
            <p className="text-gray-600 mb-6">Daftar kegiatan produktif dari bangun sampai tidur. *Checklist direset otomatis setiap hari.</p>

            <div className="space-y-8">
                {dailyRoutines.map((routine, rIndex) => (
                    <div key={routine.category} className="bg-white p-5 rounded-2xl shadow-xl border-l-8 border-indigo-400">
                        <div className="flex items-center space-x-3 mb-4">
                            <span className="p-3 rounded-full bg-indigo-500 text-white shadow-md">{routine.icon}</span>
                            <div>
                                <h2 className="text-xl font-bold text-indigo-700">{routine.category} Routine</h2>
                                <p className="text-sm text-gray-500">{routine.time}</p>
                            </div>
                        </div>

                        <ul className="space-y-3">
                            {routine.activities.map((activity) => {
                                const isChecked = checkedState[rIndex].includes(activity.id);
                                return (
                                    <li key={activity.id} className="flex items-center">
                                        <button
                                            onClick={() => handleCheck(rIndex, activity.id)}
                                            className={`p-1 mr-3 rounded-full transition ${isChecked ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                            title={isChecked ? "Tandai Belum Selesai" : "Tandai Selesai"}
                                        >
                                            <Check size={18} />
                                        </button>
                                        <span className={`text-base font-medium ${isChecked ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                                            {activity.text}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Component for Dashboard (A)
const Dashboard = ({ tasks, habits }) => {
    const today = new Date().toISOString().split('T')[0];
    const completedTasks = tasks.filter(t => t.completed).length;
    const totalTasks = tasks.length;
    const todayHabits = habits.filter(h => h.checkedToday).length;
    const totalHabits = habits.length;

    const top3Priorities = tasks
        .filter(t => !t.completed)
        .sort((a, b) => a.priority === 'Penting - Mendesak' ? -1 : 1) // Simple sort
        .slice(0, 3);

    const longestStreak = habits.reduce((max, habit) => Math.max(max, habit.streak), 0);

    return (
        <div className="p-6">
            <h1 className="text-3xl font-extrabold text-indigo-800 mb-8">Selamat Datang di Portal Produktifmu!</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* 1. Progress To-Do Hari Ini */}
                <div className="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-indigo-500 transform hover:scale-[1.01] transition">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold text-indigo-600">Progress To-Do</h2>
                        <ListChecks className="text-indigo-400" size={28} />
                    </div>
                    <p className="text-4xl font-extrabold mt-3 text-indigo-800">
                        {completedTasks} / {totalTasks}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Tugas selesai hari ini</p>
                    <div className="h-2 bg-gray-200 rounded-full mt-4">
                        <div
                            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                            style={{ width: `${totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0}%` }}
                        ></div>
                    </div>
                </div>

                {/* 2. Grafik Kebiasaan (Habits Streak) */}
                <div className="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-pink-500 transform hover:scale-[1.01] transition">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold text-pink-600">Kebiasaan Hari Ini</h2>
                        <Flame className="text-pink-400" size={28} />
                    </div>
                    <p className="text-4xl font-extrabold mt-3 text-pink-800">
                        {todayHabits} / {totalHabits}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Kebiasaan dicentang</p>
                    <p className="text-xs font-semibold text-gray-700 mt-4">Streak Terlama: {longestStreak} hari 👑</p>
                </div>

                {/* 3. Jam Produktif (Mock) */}
                <div className="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-green-500 transform hover:scale-[1.01] transition">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold text-green-600">Jam Produktif</h2>
                        <Clock className="text-green-400" size={28} />
                    </div>
                    <p className="text-4xl font-extrabold mt-3 text-green-800">
                        3.5 Jam
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Fokus Mode Selesai</p>
                    <div className="flex items-center mt-4 text-sm font-medium text-gray-700">
                        <CheckCircle size={16} className="mr-2 text-green-500" /> Waktu idealmu: 4 Jam
                    </div>
                </div>

                {/* 4. Mood Tracking (Mock) */}
                <div className="bg-white p-6 rounded-2xl shadow-xl border-l-4 border-yellow-500 transform hover:scale-[1.01] transition">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold text-yellow-600">Mood Hari Ini</h2>
                        <Brain className="text-yellow-400" size={28} />
                    </div>
                    <p className="text-5xl mt-2">😊</p>
                    <p className="text-lg font-semibold text-yellow-800 mt-2">Semangat!</p>
                    <p className="text-xs text-gray-500 mt-1">Dari Refleksi Harian</p>
                </div>
            </div>

            {/* Agenda 3 Prioritas Utama Hari Ini */}
            <div className="mt-8 bg-white p-6 rounded-2xl shadow-2xl">
                <h2 className="text-2xl font-extrabold text-indigo-800 mb-4 flex items-center">
                    <Target className="mr-2 text-red-500" /> Top 3 Priorities ({today})
                </h2>
                <div className="space-y-3">
                    {top3Priorities.length > 0 ? (
                        top3Priorities.map((task, index) => (
                            <div key={task.id} className="flex items-center p-3 bg-red-50 rounded-lg border-l-4 border-red-500">
                                <span className="text-xl font-bold text-red-600 mr-3">{index + 1}.</span>
                                <p className="text-lg text-gray-800 font-medium flex-1">{task.name}</p>
                                <span className="text-sm text-gray-500 bg-white px-2 py-0.5 rounded-full shadow">Deadline: {task.deadline}</span>
                            </div>
                        ))
                    ) : (
                        <p className="text-gray-500 italic">Tidak ada prioritas utama yang harus diselesaikan hari ini. Waktunya santai atau cari tugas baru!</p>
                    )}
                </div>
            </div>
        </div>
    );
};

// Component for Focus Mode (F) - Pomodoro Timer (MOCK)
const FocusMode = () => {
    const [isPomodoro, setIsPomodoro] = useState(true);
    const [time, setTime] = useState(25 * 60); // 25 minutes in seconds
    const [isActive, setIsActive] = useState(false);
    const [note, setNote] = useState('');

    const toggleMode = () => {
        setIsPomodoro(prev => !prev);
        setTime(isPomodoro ? (5 * 60) : (25 * 60)); // Toggle between 25/5
        setIsActive(false);
    };

    const resetTimer = () => {
        setIsActive(false);
        setTime(isPomodoro ? (25 * 60) : (5 * 60));
    };

    useEffect(() => {
        let interval = null;
        if (isActive && time > 0) {
            interval = setInterval(() => {
                setTime(time => time - 1);
            }, 1000);
        } else if (time === 0) {
            clearInterval(interval);
            setIsActive(false);
            // In a real app, this would trigger a notification/sound
            // Menggunakan konsol.log sebagai ganti alert()
            console.log('Sesi selesai! Ambil istirahat.');
        }
        return () => clearInterval(interval);
    }, [isActive, time, isPomodoro]);

    const formatTime = (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="p-6">
            <h1 className="text-3xl font-extrabold text-indigo-800 mb-6 flex items-center">
                <Brain className="mr-3" /> Focus Mode (Pomodoro)
            </h1>

            <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-2xl text-center">
                <p className="text-xl font-semibold mb-6 text-gray-700">
                    Mode Saat Ini: <span className={`font-extrabold ${isPomodoro ? 'text-red-500' : 'text-green-500'}`}>{isPomodoro ? 'FOCUS (25 Min)' : 'BREAK (5 Min)'}</span>
                </p>

                {/* Timer Display */}
                <div className="relative inline-block">
                    <svg className="w-64 h-64">
                        <circle
                            className="text-gray-200"
                            strokeWidth="10"
                            stroke="currentColor"
                            fill="transparent"
                            r="120"
                            cx="128"
                            cy="128"
                        />
                        <circle
                            className={`${isPomodoro ? 'text-red-500' : 'text-green-500'}`}
                            strokeWidth="10"
                            strokeDasharray={2 * Math.PI * 120}
                            strokeDashoffset={(2 * Math.PI * 120) * (1 - (time / (isPomodoro ? 1500 : 300)))}
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="transparent"
                            r="120"
                            cx="128"
                            cy="128"
                            style={{ transition: 'stroke-dashoffset 1s linear' }}
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-6xl font-black text-indigo-800">{formatTime(time)}</span>
                    </div>
                </div>


                {/* Controls */}
                <div className="flex justify-center space-x-4 mt-6">
                    <button
                        onClick={() => setIsActive(prev => !prev)}
                        className={`py-3 px-8 text-white font-bold rounded-xl transition transform hover:scale-105 shadow-lg ${isActive ? 'bg-red-500 hover:bg-red-600 shadow-red-300/50' : 'bg-green-500 hover:bg-green-600 shadow-green-300/50'}`}
                    >
                        {isActive ? 'Pause' : 'Mulai'}
                    </button>
                    <button
                        onClick={resetTimer}
                        className="py-3 px-8 bg-gray-200 text-gray-800 font-bold rounded-xl hover:bg-gray-300 transition transform hover:scale-105"
                    >
                        Reset
                    </button>
                </div>
                <button
                    onClick={toggleMode}
                    className="mt-4 text-sm text-indigo-600 font-semibold hover:text-indigo-800 transition"
                >
                    Switch ke {isPomodoro ? 'Break Mode (5 Min)' : 'Focus Mode (25 Min)'}
                </button>

                {/* Notes and Music */}
                <div className="mt-8 pt-6 border-t border-gray-100">
                    <h3 className="text-lg font-bold text-indigo-700 mb-3">Catatan Sesi Fokus</h3>
                    <textarea
                        className="w-full p-3 border-2 border-indigo-200 rounded-lg focus:border-indigo-500 transition shadow-sm h-24"
                        placeholder="Apa yang kamu kerjakan? Catatan hasil sesi..."
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    ></textarea>

                    <div className="mt-4 text-sm text-gray-600 flex items-center justify-center">
                        <div className="p-2 bg-indigo-50 rounded-full mr-2">🎶</div> Musik Fokus/White Noise (Integrasi Mock)
                    </div>
                </div>
            </div>
        </div>
    );
};

// Placeholder components for other pages (E, G, H, I)
const CalendarView = () => (
    <div className="p-6">
        <h1 className="text-3xl font-extrabold text-indigo-800 mb-6 flex items-center"><CalendarIcon className="mr-3" /> Kalender</h1>
        <div className="bg-white p-6 rounded-xl shadow-xl border-l-4 border-blue-500">
            <p className="text-gray-700">Tampilan Kalender (Daily–Weekly–Monthly View) untuk melihat jadwal kuliah, kerja, konten, deadline, dan event. (Mock: Integrasi kalender kompleks memerlukan library pihak ketiga).</p>
            <div className="mt-4 grid grid-cols-7 gap-1 text-center font-bold text-sm">
                {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(day => <div key={day} className="text-blue-600">{day}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1 mt-1 text-center h-48 border p-1 rounded-lg">
                <div className="col-span-full text-gray-400 flex items-center justify-center">...Tampilan tanggal dan event...</div>
            </div>
        </div>
    </div>
);

const ReflectionPage = () => {
    const [mood, setMood] = useState('😊');
    const [achievement, setAchievement] = useState('Mengerjakan tugas skripsi 2 jam tanpa distraksi.');
    const [challenge, setChallenge] = useState('Terlalu banyak distraksi dari media sosial.');
    const [improvement, setImprovement] = useState('Mulai Focus Mode segera setelah selesai rutinitas pagi.');

    return (
        <div className="p-6">
            <h1 className="text-3xl font-extrabold text-indigo-800 mb-6 flex items-center"><CheckCircle className="mr-3" /> Reflection Page (Refleksi Harian)</h1>
            <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-2xl space-y-6">
                <p className="text-lg font-bold text-gray-700 border-b pb-3">Refleksi Otomatis untuk {new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>

                <div className="flex items-center space-x-4">
                    <label className="text-xl font-semibold text-indigo-600">Mood Hari Ini?</label>
                    <select
                        value={mood}
                        onChange={(e) => setMood(e.target.value)}
                        className="text-4xl p-2 bg-gray-100 rounded-xl"
                    >
                        <option value="😊">😊 Semangat</option>
                        <option value="😐">😐 Biasa Saja</option>
                        <option value="😭">😭 Sedih/Lelah</option>
                        <option value="🥳">🥳 Luar Biasa</option>
                    </select>
                </div>

                {/* Question Blocks */}
                <div className="space-y-4">
                    {[{ title: 'Apa pencapaian hari ini?', value: achievement, setter: setAchievement },
                      { title: 'Apa tantangan hari ini?', value: challenge, setter: setChallenge },
                      { title: 'Apa yang perlu diperbaiki?', value: improvement, setter: setImprovement }].map((item, index) => (
                        <div key={index} className="border-l-4 border-pink-400 pl-4 py-2 bg-pink-50 rounded-lg">
                            <label className="block text-lg font-semibold text-pink-700 mb-2">{item.title}</label>
                            <textarea
                                className="w-full p-3 border border-pink-200 rounded-lg focus:border-pink-500 transition shadow-sm h-20"
                                value={item.value}
                                onChange={(e) => item.setter(e.target.value)}
                            />
                        </div>
                    ))}
                </div>

                <button className="w-full py-3 bg-indigo-500 text-white font-bold rounded-xl hover:bg-indigo-600 transition shadow-lg shadow-indigo-300/50">
                    Simpan Refleksi
                </button>
            </div>
        </div>
    );
};

const LibraryPage = () => {
    const [books, setBooks] = useState([initialLibraryItem]);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const ReadingCard = ({ book }) => {
        const progress = Math.min(100, (book.currentPage / book.totalPages) * 100);
        return (
            <div className="bg-white p-5 rounded-2xl shadow-xl border-l-4 border-amber-500 transform hover:scale-[1.01] transition">
                <h2 className="text-xl font-extrabold text-amber-700">{book.title}</h2>
                <p className="text-sm text-gray-500 italic mb-3">Oleh {book.author}</p>

                <div className="text-sm text-gray-800 mb-3">
                    <p className="font-semibold">Highlight:</p>
                    <blockquote className="italic border-l-2 pl-2 text-gray-600">"{book.highlight}"</blockquote>
                </div>

                <div className="mb-4">
                    <p className="text-sm font-semibold text-gray-700">Progress: {book.currentPage} / {book.totalPages} halaman</p>
                    <div className="h-2 bg-gray-200 rounded-full mt-1">
                        <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                </div>

                <p className="text-xs font-medium text-gray-600 border-t pt-3">Refleksi: {book.reflection}</p>
            </div>
        );
    };

    return (
        <div className="p-6">
            <h1 className="text-3xl font-extrabold text-indigo-800 mb-6 flex items-center">
                <BookOpen className="mr-3" /> Library Page (Bacaan/Belajar)
            </h1>

            <button
                onClick={() => setIsModalOpen(true)}
                className="mb-6 flex items-center bg-amber-500 text-white py-3 px-6 rounded-xl font-bold shadow-lg shadow-amber-300/50 hover:bg-amber-600 transition transform hover:scale-[1.02]"
            >
                <Plus size={20} className="mr-2" /> Tambah Buku Baru
            </button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {books.map((book, index) => <ReadingCard key={index} book={book} />)}
            </div>

            <Modal isOpen={isModalOpen} title="Tambah Buku Baru" onClose={() => setIsModalOpen(false)}>
                <p>Form untuk menambah buku, mencatat highlight, dan tracking progress halaman. (Mock)</p>
                <button
                    onClick={() => setIsModalOpen(false)}
                    className="mt-4 py-2 px-4 bg-indigo-500 text-white font-semibold rounded-lg hover:bg-indigo-600 transition"
                >
                    Tutup
                </button>
            </Modal>
        </div>
    );
};

const AnalyticsPage = () => {
    const stats = [
        { title: "Hari Paling Produktif", value: "Rabu", icon: <BarChart />, color: "text-green-500" },
        { title: "Kebiasaan Terbanyak", value: "Minum air (Streak 5)", icon: <Flame />, color: "text-red-500" },
        { title: "Waktu Fokus Terbanyak", value: "20 Jam", icon: <Clock />, color: "text-blue-500" },
        { title: "Target Bulan Berjalan", value: "70% Selesai", icon: <Target />, color: "text-pink-500" },
    ];
    return (
        <div className="p-6">
            <h1 className="text-3xl font-extrabold text-indigo-800 mb-8 flex items-center">
                <BarChart className="mr-3" /> Analytics / Insight
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, index) => (
                    <div key={index} className="bg-white p-6 rounded-2xl shadow-xl border-t-8 border-indigo-200 hover:shadow-2xl transition">
                        <div className={`text-3xl font-extrabold ${stat.color} mb-2`}>{stat.icon}</div>
                        <h2 className="text-sm font-medium text-gray-500">{stat.title}</h2>
                        <p className="text-xl font-bold text-indigo-800 mt-1">{stat.value}</p>
                    </div>
                ))}
            </div>

            <div className="mt-8 bg-white p-6 rounded-2xl shadow-xl">
                <h2 className="text-2xl font-extrabold text-indigo-800 mb-4">Grafik Tren Produktivitas</h2>
                <div className="h-64 border p-4 rounded-lg flex items-center justify-center text-gray-400">
                    ...Placeholder untuk grafik (memerlukan library D3/Recharts)...
                </div>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---

const App = () => {
    const [currentPage, setCurrentPage] = useState('dashboard');
    const { db, userId, isAuthReady } = useFirebase();

    // Fetch data using the custom hook
    const {
        data: tasks,
        loading: tasksLoading,
        addData: addTask,
        updateData: updateTask,
        deleteData: deleteTask
    } = useFirestoreCollection(db, userId, 'tasks');

    const {
        data: habits,
        loading: habitsLoading,
        addData: addHabit,
        updateData: updateHabit,
        deleteData: deleteHabit
    } = useFirestoreCollection(db, userId, 'habits');

    // Add initial mock data if the collections are empty and authentication is ready
    useEffect(() => {
        if (isAuthReady && !tasksLoading && tasks.length === 0 && userId) {
            console.log("Adding initial mock task...");
            addTask(initialTask);
        }
        if (isAuthReady && !habitsLoading && habits.length === 0 && userId) {
            console.log("Adding initial mock habit...");
            addHabit(initialHabit);
        }
    }, [isAuthReady, tasksLoading, habitsLoading, tasks.length, habits.length, addTask, addHabit, userId]);


    const navItems = [
        { id: 'dashboard', name: 'Dashboard', icon: Home, component: <Dashboard tasks={tasks} habits={habits} /> },
        { id: 'routine', name: 'Daily Routine', icon: Clock, component: <DailyRoutine tasks={tasks} habits={habits} updateTask={updateTask} /> },
        { id: 'tasks', name: 'Task Manager', icon: ListChecks, component: <TaskManager tasks={tasks} addTask={addTask} updateTask={updateTask} deleteTask={deleteTask} /> },
        { id: 'habits', name: 'Habit Tracker', icon: Target, component: <HabitTracker habits={habits} addHabit={addHabit} updateHabit={updateHabit} deleteHabit={deleteHabit} /> },
        { id: 'focus', name: 'Focus Mode', icon: Brain, component: <FocusMode /> },
        { id: 'calendar', name: 'Kalender', icon: CalendarIcon, component: <CalendarView /> },
        { id: 'reflection', name: 'Reflection', icon: CheckCircle, component: <ReflectionPage /> },
        { id: 'library', name: 'Library', icon: BookOpen, component: <LibraryPage /> },
        { id: 'analytics', name: 'Analytics', icon: BarChart, component: <AnalyticsPage /> },
    ];

    const renderContent = () => {
        if (!isAuthReady) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center text-indigo-600">
                        <svg className="animate-spin h-8 w-8 text-indigo-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <p className="mt-4 font-semibold">Memuat data dan autentikasi...</p>
                    </div>
                </div>
            );
        }

        const currentItem = navItems.find(item => item.id === currentPage);
        return currentItem ? currentItem.component : <Dashboard tasks={tasks} habits={habits} />;
    };

    const NavItem = ({ id, name, icon: Icon }) => {
        const isActive = currentPage === id;
        return (
            <li className="mb-2">
                <button
                    onClick={() => setCurrentPage(id)}
                    className={`flex items-center w-full p-3 rounded-xl transition transform hover:translate-x-1 ${isActive ? 'bg-indigo-500 text-white font-bold shadow-lg shadow-indigo-300/50' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                    <Icon size={20} className="mr-3" />
                    <span className="text-sm">{name}</span>
                </button>
            </li>
        );
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-100 to-purple-200 font-sans antialiased text-gray-800">
            {/* PERBAIKAN: Mengubah <style jsx global> menjadi <style> standar untuk menghindari warning boolean attribute */}
            <style>{`
                /* Ensure all elements use Inter (Tailwind default) and smooth scrolling for UX */
                html {
                    scroll-behavior: smooth;
                }
                body {
                    font-family: 'Inter', sans-serif;
                }
            `}</style>
            <div className="flex">
                {/* Sidebar Navigation */}
                <div className="w-64 p-5 h-screen sticky top-0 bg-white shadow-2xl z-10 hidden lg:block">
                    <h1 className="text-3xl font-black text-indigo-700 mb-8 mt-2">
                        <span className="text-pink-500">Genz</span>Planner
                    </h1>
                    <nav>
                        <ul className="space-y-1">
                            {navItems.map(item => (
                                <NavItem key={item.id} {...item} />
                            ))}
                        </ul>
                    </nav>
                    <div className="absolute bottom-5 left-5 right-5 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 break-all">
                        User ID: {userId || 'Authenticating...'}
                    </div>
                </div>

                {/* Main Content Area */}
                <main className="flex-1 overflow-y-auto p-4 md:p-8">
                    {/* Mobile Navigation Dropdown (Hidden on large screens) */}
                    <div className="lg:hidden mb-4 sticky top-0 z-20 bg-indigo-100/95 backdrop-blur-sm p-3 rounded-xl shadow-md">
                        <select
                            value={currentPage}
                            onChange={(e) => setCurrentPage(e.target.value)}
                            className="w-full p-3 border-2 border-indigo-300 rounded-xl bg-white text-indigo-800 font-semibold shadow-inner appearance-none"
                        >
                            {navItems.map(item => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                        </select>
                    </div>
                    {/* Render Content */}
                    <div className="min-h-[calc(100vh-6rem)]">
                        {renderContent()}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default App;