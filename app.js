import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, updateDoc } from 'firebase/firestore';
import { Home, ListChecks, Watch, Calendar, BookOpen, BarChart3, TrendingUp, Sun, Moon } from 'lucide-react';

// --- Konfigurasi Firebase dari Variabel Lingkungan Vercel (Vite) ---
const firebaseConfig = {
    apiKey: import.meta.env.VITE_API_KEY,
    authDomain: import.meta.env.VITE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_APP_ID,
    // measurementId: import.meta.env.VITE_MEASUREMENT_ID, // Opsional
};
// --------------------------------------------------------------------------

// Komponen utama aplikasi
const App = () => {
    // State untuk instance Firebase
    const [dbInstance, setDbInstance] = useState(null);
    const [authInstance, setAuthInstance] = useState(null);

    const [userId, setUserId] = useState('Authenticating...');
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [currentView, setCurrentView] = useState('Dashboard');
    const [theme, setTheme] = useState('dark'); // State untuk tema: 'dark' atau 'light'

    const [tasks, setTasks] = useState([]);
    const [habits, setHabits] = useState([]);
    const [routines, setRoutines] = useState([]);
    const [dailyReflection, setDailyReflection] = useState('');
    const [error, setError] = useState(null);
    const [loadingMessage, setLoadingMessage] = useState('Memuat data dan autentikasi...');


    // Fungsi utilitas untuk mengatasi hilangnya __app_id di Vercel
    const getAppId = useCallback(() => {
        // Di Vercel/Vite, kita tidak memiliki __app_id, jadi kita gunakan project ID atau fallback default
        return firebaseConfig.projectId || 'genz-planner-default';
    }, []);

    // Fungsi utilitas untuk mendapatkan path koleksi pengguna (Data Private)
    const getUserCollectionRef = useCallback((uid, collectionName) => {
        if (!dbInstance) return;
        const appId = getAppId();
        return collection(dbInstance, `artifacts/${appId}/users/${uid}/${collectionName}`);
    }, [dbInstance, getAppId]);

    // Fungsi utilitas untuk mendapatkan path koleksi publik
    const getPublicCollectionRef = useCallback((collectionName) => {
        if (!dbInstance) return;
        const appId = getAppId();
        return collection(dbInstance, `artifacts/${appId}/public/data/${collectionName}`);
    }, [dbInstance, getAppId]);


    // 1. Inisialisasi Firebase & Autentikasi
    useEffect(() => {
        const setupAuth = async () => {
            try {
                // Periksa apakah konfigurasi Firebase valid sebelum inisialisasi
                if (!firebaseConfig.apiKey) {
                    setError("Kesalahan Konfigurasi Firebase: API Key hilang. Pastikan Anda mengatur Variabel Lingkungan VITE_API_KEY di Vercel.");
                    setLoadingMessage("Gagal memuat. Cek Console & Variabel Lingkungan Vercel.");
                    return;
                }
                
                // --- INISIALISASI DIPINDAH KE SINI ---
                const app = initializeApp(firebaseConfig);
                const db = getFirestore(app);
                const auth = getAuth(app);

                // Simpan instance ke state
                setDbInstance(db);
                setAuthInstance(auth);
                // ------------------------------------

                // Coba masuk dengan custom token (jika ada dari lingkungan Canvas)
                const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    // Jika tidak ada token (misalnya di Vercel), masuk secara anonim
                    await signInAnonymously(auth);
                }

                // Setelah auth siap, set listener
                const unsubscribe = onAuthStateChanged(auth, (user) => {
                    if (user) {
                        setUserId(user.uid);
                    } else {
                        setUserId("Anonymous");
                    }
                    setIsAuthReady(true);
                    setLoadingMessage(null); // Hapus pesan loading setelah auth siap
                });
                
                // Cleanup listener auth
                return unsubscribe;

            } catch (err) {
                console.error("Kesalahan saat autentikasi Firebase:", err);
                setError(`Gagal autentikasi: ${err.message}. Coba refresh atau periksa konfigurasi.`);
                setLoadingMessage("Gagal autentikasi.");
            }
        };

        setupAuth();

        // Mengatur tema awal
        const storedTheme = localStorage.getItem('theme');
        if (storedTheme) {
            setTheme(storedTheme);
        } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
            setTheme('light');
        }
        
        // Cleanup untuk auth listener ditangani di dalam setupAuth
        // Namun, jika ada error di setupAuth, kita harus mencegah listener berikutnya berjalan.
        return () => {
             // Opsional: cleanup tambahan jika ada
        };
    }, []);

    // 2. Fetch Data (Realtime Listeners)
    useEffect(() => {
        // Hanya jalankan listener data jika autentikasi dan instance DB siap
        if (!isAuthReady || userId === 'Authenticating...' || !dbInstance) return;

        // Mendefinisikan listeners untuk data pribadi pengguna
        const listeners = [];

        try {
            // Listener untuk Tasks
            const tasksRef = getUserCollectionRef(userId, 'tasks');
            if (tasksRef) {
                listeners.push(onSnapshot(tasksRef, (snapshot) => {
                    const fetchedTasks = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data(),
                        // Konversi timestamp ke objek Date jika ada
                        createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : new Date(),
                    }));
                    setTasks(fetchedTasks);
                }));
            }

            // Listener untuk Habits
            const habitsRef = getUserCollectionRef(userId, 'habits');
            if (habitsRef) {
                listeners.push(onSnapshot(habitsRef, (snapshot) => {
                    const fetchedHabits = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    setHabits(fetchedHabits);
                }));
            }

            // Listener untuk Routines
            const routinesRef = getUserCollectionRef(userId, 'routines');
            if (routinesRef) {
                listeners.push(onSnapshot(routinesRef, (snapshot) => {
                    const fetchedRoutines = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    setRoutines(fetchedRoutines);
                }));
            }

             // Listener untuk Reflection
             const reflectionDocRef = doc(getUserCollectionRef(userId, 'reflections'), new Date().toISOString().split('T')[0]);
             listeners.push(onSnapshot(reflectionDocRef, (docSnap) => {
                 if (docSnap.exists()) {
                     setDailyReflection(docSnap.data().content || '');
                 } else {
                     setDailyReflection('');
                 }
             }));

        } catch (e) {
            console.error("Error setting up data listeners:", e);
            setError(`Gagal memuat data: ${e.message}`);
        }

        // Cleanup listeners saat komponen unmount atau userId berubah
        return () => {
            listeners.forEach(unsubscribe => unsubscribe());
        };
    }, [isAuthReady, userId, dbInstance, getUserCollectionRef]);

    // Fungsi untuk mengubah tema
    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
    };

    // Fungsi untuk menambah, update, dan delete data (Contoh Task)
    const handleAddTask = async (title) => {
        const tasksRef = getUserCollectionRef(userId, 'tasks');
        if (!userId || !title || !tasksRef) return;
        try {
            // Menggunakan addDoc untuk ID otomatis
            await setDoc(doc(tasksRef), { 
                title,
                completed: false,
                createdAt: new Date(),
                category: 'Uncategorized'
            });
        } catch (e) {
            console.error("Error adding task:", e);
            setError("Gagal menambah tugas.");
        }
    };

    const handleToggleTask = async (id, currentStatus) => {
        const tasksRef = getUserCollectionRef(userId, 'tasks');
        if (!userId || !id || !tasksRef) return;
        try {
            await updateDoc(doc(tasksRef, id), {
                completed: !currentStatus
            });
        } catch (e) {
            console.error("Error toggling task:", e);
            setError("Gagal mengubah status tugas.");
        }
    };

    const handleSaveReflection = async (content) => {
        const reflectionsRef = getUserCollectionRef(userId, 'reflections');
        if (!userId || !content || !reflectionsRef) return;
        const today = new Date().toISOString().split('T')[0];
        try {
            await setDoc(doc(reflectionsRef, today), {
                content,
                updatedAt: new Date()
            }, { merge: true });
        } catch (e) {
            console.error("Error saving reflection:", e);
            setError("Gagal menyimpan refleksi.");
        }
    };

    // Data Sidebar untuk navigasi
    const navItems = useMemo(() => ([
        { name: 'Dashboard', icon: Home, component: 'Dashboard' },
        { name: 'Daily Routine', icon: Sun, component: 'DailyRoutine' },
        { name: 'Task Manager', icon: ListChecks, component: 'TaskManager' },
        { name: 'Habit Tracker', icon: TrendingUp, component: 'HabitTracker' },
        { name: 'Focus Mode', icon: Watch, component: 'FocusMode' },
        { name: 'Kalender', icon: Calendar, component: 'Calendar' },
        { name: 'Reflection', icon: BookOpen, component: 'Reflection' },
        { name: 'Library', icon: BarChart3, component: 'Library' },
        { name: 'Analytics', icon: BarChart3, component: 'Analytics' },
    ]), []);

    // Komponen Tampilan (Render Content)
    const renderContent = () => {
        if (error) {
            return (
                <div className="p-8 text-center">
                    <h2 className="text-xl font-bold text-red-500 mb-4">Kesalahan Kritis</h2>
                    <p className="text-sm text-gray-400">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition"
                    >
                        Muat Ulang Aplikasi
                    </button>
                </div>
            );
        }

        // Tampilkan loading jika belum siap atau DB belum terinisialisasi
        if (!isAuthReady || loadingMessage || !dbInstance) {
            return (
                <div className="flex flex-col items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-purple-500 mb-4"></div>
                    <p className="text-lg font-semibold text-gray-400">{loadingMessage}</p>
                </div>
            );
        }

        // Mengganti konten berdasarkan currentView
        switch (currentView) {
            case 'Dashboard':
                return <DashboardView tasks={tasks} userId={userId} dailyReflection={dailyReflection} />;
            case 'TaskManager':
                return <TaskManagerView tasks={tasks} onAddTask={handleAddTask} onToggleTask={handleToggleTask} />;
            case 'Reflection':
                return <ReflectionView content={dailyReflection} onSave={handleSaveReflection} />;
            // Kasus lainnya (jika belum diimplementasikan)
            default:
                return <UnderConstruction name={currentView} />;
        }
    };

    // --- Sub-Komponen Tampilan ---

    const UnderConstruction = ({ name }) => (
        <div className="p-8">
            <h2 className="text-3xl font-bold mb-4 text-purple-400">{name}</h2>
            <p className="text-gray-400">Halaman ini sedang dalam tahap pengembangan. Segera hadir!</p>
        </div>
    );

    const DashboardView = ({ tasks, userId, dailyReflection }) => {
        const completedTasks = tasks.filter(t => t.completed).length;
        const totalTasks = tasks.length;
        return (
            <div className="p-8 space-y-6">
                <h2 className="text-3xl font-bold text-white">Dashboard Harian</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StatCard title="Tugas Selesai" value={`${completedTasks} / ${totalTasks}`} color="bg-green-500/10" icon={ListChecks} />
                    <StatCard title="Total Tugas" value={totalTasks} color="bg-blue-500/10" icon={ListChecks} />
                    <StatCard title="Refleksi Hari Ini" value={dailyReflection ? 'Selesai' : 'Belum'} color={dailyReflection ? "bg-purple-500/10" : "bg-yellow-500/10"} icon={BookOpen} />
                </div>
                <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-semibold mb-3 text-white">Tugas yang Belum Selesai</h3>
                    {tasks.filter(t => !t.completed).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5).map(task => (
                        <p key={task.id} className="text-gray-400 mb-1 flex items-center"><ListChecks size={16} className="mr-2 text-purple-400" />{task.title}</p>
                    ))}
                    {tasks.length === 0 && <p className="text-gray-500">Tidak ada tugas hari ini. Santai sejenak!</p>}
                </div>
            </div>
        );
    };

    const TaskManagerView = ({ tasks, onAddTask, onToggleTask }) => {
        const [newTask, setNewTask] = useState('');

        const handleSubmit = (e) => {
            e.preventDefault();
            if (newTask.trim()) {
                onAddTask(newTask.trim());
                setNewTask('');
            }
        };

        const pendingTasks = tasks.filter(t => !t.completed).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const completedTasks = tasks.filter(t => t.completed).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        return (
            <div className="p-8">
                <h2 className="text-3xl font-bold mb-6 text-white">Task Manager</h2>
                <form onSubmit={handleSubmit} className="mb-8 flex space-x-3">
                    <input
                        type="text"
                        value={newTask}
                        onChange={(e) => setNewTask(e.target.value)}
                        placeholder="Tambahkan tugas baru..."
                        className="flex-grow p-3 rounded-lg bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg transition duration-200 shadow-md">
                        Tambah
                    </button>
                </form>

                <div className="space-y-6">
                    <div>
                        <h3 className="text-xl font-semibold mb-3 text-white border-b border-gray-700 pb-2">Tugas yang Belum Selesai ({pendingTasks.length})</h3>
                        <div className="space-y-3">
                            {pendingTasks.map(task => (
                                <TaskItem key={task.id} task={task} onToggleTask={onToggleTask} />
                            ))}
                            {pendingTasks.length === 0 && <p className="text-gray-500">Semua tugas selesai. Waktunya istirahat!</p>}
                        </div>
                    </div>

                    <div>
                        <h3 className="text-xl font-semibold mt-6 mb-3 text-gray-400 border-b border-gray-700 pb-2">Selesai ({completedTasks.length})</h3>
                        <div className="space-y-3">
                            {completedTasks.map(task => (
                                <TaskItem key={task.id} task={task} onToggleTask={onToggleTask} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const TaskItem = ({ task, onToggleTask }) => (
        <div className={`flex items-center p-3 rounded-lg shadow-sm transition duration-150 ${task.completed ? 'bg-gray-700/50 line-through text-gray-500' : 'bg-gray-800 hover:bg-gray-700'}`}>
            <input
                type="checkbox"
                checked={task.completed}
                onChange={() => onToggleTask(task.id, task.completed)}
                className="form-checkbox h-5 w-5 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500 cursor-pointer"
            />
            <span className={`ml-3 flex-grow text-sm ${task.completed ? 'text-gray-500' : 'text-white'}`}>
                {task.title}
            </span>
        </div>
    );

    const ReflectionView = ({ content, onSave }) => {
        const [reflectionText, setReflectionText] = useState(content);
        const [isSaving, setIsSaving] = useState(false);
        const [saveStatus, setSaveStatus] = useState(null);

        useEffect(() => {
            setReflectionText(content);
        }, [content]);

        const handleSave = async () => {
            setIsSaving(true);
            setSaveStatus(null);
            try {
                await onSave(reflectionText);
                setSaveStatus('Tersimpan!');
            } catch (e) {
                setSaveStatus('Gagal menyimpan.');
            } finally {
                setIsSaving(false);
                setTimeout(() => setSaveStatus(null), 3000);
            }
        };

        return (
            <div className="p-8">
                <h2 className="text-3xl font-bold mb-6 text-white">Refleksi Harian</h2>
                <p className="text-gray-400 mb-4">Tuliskan apa yang Anda pelajari, tantangan, dan tujuan untuk besok.</p>
                <textarea
                    value={reflectionText}
                    onChange={(e) => {
                        setReflectionText(e.target.value);
                        setSaveStatus(null); // Reset status saat mengetik
                    }}
                    placeholder="Apa yang ada di pikiran Anda hari ini..."
                    rows="10"
                    className="w-full p-4 rounded-xl bg-gray-800 text-white placeholder-gray-500 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 transition resize-none"
                />
                <div className="flex justify-end items-center mt-4 space-x-4">
                    {saveStatus && <span className={`text-sm font-semibold ${saveStatus === 'Tersimpan!' ? 'text-green-500' : 'text-red-500'}`}>{saveStatus}</span>}
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className={`font-bold py-2 px-5 rounded-lg transition duration-200 shadow-md ${isSaving ? 'bg-purple-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}
                    >
                        {isSaving ? 'Menyimpan...' : 'Simpan Refleksi'}
                    </button>
                </div>
            </div>
        );
    };

    const StatCard = ({ title, value, color, icon: Icon }) => (
        <div className={`p-5 rounded-xl shadow-lg border border-gray-700 ${color}`}>
            <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-400">{title}</p>
                <Icon size={24} className="text-purple-400" />
            </div>
            <h4 className="text-3xl font-extrabold mt-2 text-white">{value}</h4>
        </div>
    );

    const Sidebar = ({ currentView, setCurrentView, navItems, theme, toggleTheme, userId }) => {
        return (
            <div className={`w-64 p-5 flex flex-col justify-between ${theme === 'dark' ? 'bg-gray-900 border-r border-gray-800' : 'bg-white border-r border-gray-200'}`}>
                <div>
                    <h1 className={`text-2xl font-bold mb-8 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>GenZPlanner</h1>
                    <nav className="space-y-2">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = currentView === item.name;
                            return (
                                <button
                                    key={item.name}
                                    onClick={() => setCurrentView(item.component)}
                                    className={`w-full text-left flex items-center p-3 rounded-xl transition duration-150 ${isActive
                                        ? 'bg-purple-600 text-white shadow-lg'
                                        : theme === 'dark'
                                            ? 'text-gray-400 hover:bg-gray-800 hover:text-white'
                                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                        }`}
                                >
                                    <Icon size={20} className="mr-3" />
                                    <span className="font-medium">{item.name}</span>
                                </button>
                            );
                        })}
                    </nav>
                </div>
                <div className="mt-8 pt-4 border-t border-gray-700 space-y-3">
                    <div className={`text-sm ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                        User ID: <span className={`font-mono break-all ${userId === 'Authenticating...' ? 'animate-pulse' : theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>{userId}</span>
                    </div>
                    <button
                        onClick={toggleTheme}
                        className={`w-full flex items-center justify-center p-2 rounded-xl transition duration-150 border ${theme === 'dark'
                            ? 'bg-gray-800 text-yellow-400 border-gray-700 hover:bg-gray-700'
                            : 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200'
                            }`}
                    >
                        {theme === 'dark' ? <Sun size={20} className="mr-2" /> : <Moon size={20} className="mr-2" />}
                        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className={`flex h-screen overflow-hidden ${theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50'}`}>
            <Sidebar currentView={currentView} setCurrentView={setCurrentView} navItems={navItems} theme={theme} toggleTheme={toggleTheme} userId={userId} />
            <main className={`flex-grow overflow-y-auto ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}>
                {renderContent()}
            </main>
        </div>
    );
};

export default App;