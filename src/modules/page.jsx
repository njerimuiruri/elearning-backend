'use client';

import React, { useState, useEffect } from 'react';
import axios from 'axios';

/** Helper Components defined at the top to avoid 'undefined' errors during render **/

function Card({ label, value, color, icon }) {
    return (
        <div className={`bg-white p-5 rounded-xl border-l-4 shadow-sm ${color}`}>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">{label}</div>
            <div className="text-2xl font-black text-gray-800 mt-1 flex items-center gap-2">
                {icon} {value}
            </div>
        </div>
    );
}

function Badge({ text }) {
    return (
        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-[10px] font-bold border border-gray-200">
            {text}
        </span>
    );
}

export default function ProgressPage() {
    const [fellows, setFellows] = useState([]);
    const [allModules, setAllModules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedFellow, setSelectedFellow] = useState(null);
    const [search, setSearch] = useState('');
    const [moduleFilter, setModuleFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'fullName', direction: 'asc' });

    useEffect(() => {
        const fetchModules = async () => {
            try {
                const res = await axios.get('http://localhost:3001/api/modules');
                setAllModules(res.data.modules || []);
            } catch (err) { console.error('Error fetching modules:', err); }
        };
        fetchModules();
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const token = localStorage.getItem('token');
                const params = new URLSearchParams();
                if (search) params.append('search', search);
                if (moduleFilter) params.append('module', moduleFilter);
                if (statusFilter) params.append('status', statusFilter);

                const res = await axios.get(`http://localhost:3001/api/modules/admin/fellows/progress?${params.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setFellows(res.data);
            } catch (err) {
                console.error('Error fetching fellow progress:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [search, moduleFilter, statusFilter]);

    const getOverallStats = () => {
        const total = fellows.length;
        const completed = fellows.filter(f => f.modules.every(m => m.isCompleted)).length;
        const inProgress = fellows.filter(f => f.modules.some(m => m.progress > 0) && !f.modules.every(m => m.isCompleted)).length;
        const notStarted = fellows.filter(f => f.modules.every(m => m.progress === 0)).length;
        return { total, completed, inProgress, notStarted };
    };

    const calculateAvgProgress = (modules) => {
        if (!modules || modules.length === 0) return 0;
        return Math.round(modules.reduce((acc, m) => acc + (m.progress || 0), 0) / modules.length);
    };

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    const sortedFellows = [...fellows].sort((a, b) => {
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];
        if (sortConfig.key === 'avgProgress') {
            valA = calculateAvgProgress(a.modules);
            valB = calculateAvgProgress(b.modules);
        }
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const stats = getOverallStats();

    return (
        <div className="p-8 bg-gray-50 min-h-screen font-sans">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-gray-800 tracking-tight">Fellow Progress Tracker</h1>
                <div className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-full font-bold text-sm">
                    Total Fellows: {stats.total}
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <Card label="Enrolled Fellows" value={stats.total} color="border-blue-500" />
                <Card label="Completed All" value={stats.completed} color="border-green-500" icon="✅" />
                <Card label="Still In Progress" value={stats.inProgress} color="border-yellow-500" icon="🔄" />
                <Card label="Not Started" value={stats.notStarted} color="border-red-500" icon="⏳" />
            </div>

            {/* Filters Bar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-wrap gap-4 mb-6">
                <input
                    type="text" placeholder="Search name or email..."
                    className="flex-1 min-w-[200px] border p-2 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={search} onChange={(e) => setSearch(e.target.value)}
                />
                <select className="border p-2 rounded-lg bg-white" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
                    <option value="">All Modules</option>
                    {allModules.map(m => <option key={m._id} value={m._id}>{m.title}</option>)}
                </select>
                <select className="border p-2 rounded-lg bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All Statuses</option>
                    <option value="completed">Completed</option>
                    <option value="inprogress">In Progress</option>
                    <option value="notstarted">Not Started</option>
                </select>
            </div>

            {/* Table Overview */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="p-4 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('fullName')}>Fellow Name ↕</th>
                            <th className="p-4">Modules Done</th>
                            <th className="p-4 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('avgProgress')}>Overall Progress ↕</th>
                            <th className="p-4">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="4" className="p-10 text-center text-gray-400 italic">Loading fellow data...</td></tr>
                        ) : sortedFellows.map((fellow) => {
                            const avg = calculateAvgProgress(fellow.modules);
                            const done = fellow.modules.filter(m => m.isCompleted).length;
                            return (
                                <tr key={fellow.email} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                                    <td className="p-4">
                                        <div className="font-bold text-gray-900">{fellow.fullName}</div>
                                        <div className="text-xs text-gray-500">{fellow.email}</div>
                                    </td>
                                    <td className="p-4 font-medium text-gray-700">{done} / {fellow.modules.length}</td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-32 bg-gray-200 rounded-full h-2">
                                                <div
                                                    className={`h-2 rounded-full ${avg === 100 ? 'bg-green-500' : avg > 0 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                    style={{ width: `${avg}%` }}
                                                />
                                            </div>
                                            <span className="text-sm font-bold">{avg}%</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <button
                                            onClick={() => setSelectedFellow(fellow)}
                                            className="text-indigo-600 font-semibold text-sm hover:underline transition-all"
                                        >View Details</button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {!loading && sortedFellows.length === 0 && (
                    <div className="p-10 text-center text-gray-500">No results found for your search.</div>
                )}
            </div>

            {/* Detail Drawer */}
            {selectedFellow && (
                <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={() => setSelectedFellow(null)}>
                    <div
                        className="w-full max-w-lg bg-white h-full shadow-2xl p-6 overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-start mb-6 border-b pb-4">
                            <div>
                                <h2 className="text-2xl font-bold text-navy-900">👤 {selectedFellow.fullName}</h2>
                                <p className="text-gray-500">{selectedFellow.email}</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    <Badge text={selectedFellow.fellowId} />
                                    <Badge text={selectedFellow.cohort} />
                                    <Badge text={selectedFellow.region} />
                                </div>
                            </div>
                            <button onClick={() => setSelectedFellow(null)} className="text-3xl text-gray-400 hover:text-gray-600 transition-colors">&times;</button>
                        </div>

                        <h3 className="font-bold text-gray-800 mb-4 uppercase text-xs tracking-wider">Detailed Module Progress</h3>
                        <div className="space-y-4">
                            {selectedFellow.modules.sort((a, b) => (a.order || 0) - (b.order || 0)).map((mod, i) => (
                                <div key={i} className="p-4 border rounded-xl bg-gray-50">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="font-bold text-sm text-gray-800">
                                            {mod.order ? `Module ${mod.order}: ` : ''}{mod.title}
                                        </span>
                                        <span>{mod.progress === 100 ? '✅' : mod.progress > 0 ? '🔄' : '⏳'}</span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                                        <div
                                            className={`h-2 rounded-full ${mod.progress === 100 ? 'bg-green-500' : mod.progress > 0 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                            style={{ width: `${mod.progress}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between text-[10px] font-bold uppercase text-gray-500">
                                        <span>Progress: {mod.progress}%</span>
                                        <span>Lessons: {mod.completedLessons || 0}/{mod.totalLessons || 0}</span>
                                        <span>Exam: {mod.finalAssessmentPassed ? 'PASSED' : 'PENDING'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}