import React, { useEffect, useState, useRef } from 'react';
import './index.css';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Sun, Moon, FileText, Download, Repeat, Search } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, YAxis } from 'recharts';

// --- Firebase config (keep your values) ---
const firebaseConfig = {
  apiKey: "AIzaSyDdYLhcF1GSoygHxcP0ZxQRSJl9wgE4ktg",
  authDomain: "rbk-insight.firebaseapp.com",
  projectId: "rbk-insight",
  storageBucket: "rbk-insight.appspot.com",
  messagingSenderId: "720383243620",
  appId: "1:720383243620:web:bc98afad0d86be00b67671"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Backend endpoints - replace with your real endpoints
const API_BASE = "https://rbk-predictor.onrender.com";

const PREDICT_ENDPOINT = `${API_BASE}/predict`;
const RETRAIN_ENDPOINT = `${API_BASE}/retrain`;

export default function RBKInsightPortal() {
  // Auth & UI
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('rbk:dark') === 'true');
  const [loading, setLoading] = useState(false);
  const [modalMessage, setModalMessage] = useState('');

  // Location hierarchy
  const [locationHierarchy, setLocationHierarchy] = useState({});
  const [states, setStates] = useState([]);
  const [mandals, setMandals] = useState([]);
  const [rbks, setRbks] = useState([]);
  const [selectedState, setSelectedState] = useState('');
  const [selectedMandal, setSelectedMandal] = useState('');
  const [selectedRbk, setSelectedRbk] = useState('');

  // Inputs
  const [season, setSeason] = useState('Kharif');
  const [qty, setQty] = useState(10);
  const [farmers, setFarmers] = useState(50);

  // Prediction + explanations
  const [prediction, setPrediction] = useState(null);
  const [shapValues, setShapValues] = useState({});

  // Map & GeoJSON
  const [geoJsonData, setGeoJsonData] = useState(null);
  const [districtTotals, setDistrictTotals] = useState({});

  // History & filters
  const [predictionHistory, setPredictionHistory] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [filterState, setFilterState] = useState('All');
  const [filterSeason, setFilterSeason] = useState('All');
  const [filteredHistory, setFilteredHistory] = useState([]);

  // refs
  const reportRef = useRef(null);

  // --- Auth init and initial data load ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      const uid = user?.uid || crypto.randomUUID();
      setUserId(uid);
      setIsAuthReady(true);

      fetchLocationData();
      fetchGeoJson();
      subscribeHistory();
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Load hierarchical JSON created from your CSV ---
  const fetchLocationData = async () => {
    try {
      const res = await fetch('/rbk_hierarchy.json'); // put file in public/
      const hierarchy = await res.json();
      setLocationHierarchy(hierarchy);

      const stateKeys = Object.keys(hierarchy);
      setStates(stateKeys);

      const initialState = stateKeys[0] || '';
      setSelectedState(initialState);

      const initialMandals = initialState ? Object.keys(hierarchy[initialState]) : [];
      setMandals(initialMandals);
      const initialMandal = initialMandals[0] || '';
      setSelectedMandal(initialMandal);

      const initialRbks = initialMandal ? (hierarchy[initialState][initialMandal] || []) : [];
      setRbks(initialRbks);
      setSelectedRbk(initialRbks[0] || '');
    } catch (err) {
      console.error('fetchLocationData error:', err);
      setModalMessage('Failed to load location data. Put rbk_hierarchy.json in public folder.');
      setTimeout(() => setModalMessage(''), 4000);
    }
  };

  // When selectedState changes -> update mandals and RBKs
  useEffect(() => {
    if (!selectedState || !locationHierarchy[selectedState]) return;
    const mandalList = Object.keys(locationHierarchy[selectedState]);
    setMandals(mandalList);
    const firstMandal = mandalList[0] || '';
    setSelectedMandal(firstMandal);

    const rbkList = firstMandal ? (locationHierarchy[selectedState][firstMandal] || []) : [];
    setRbks(rbkList);
    setSelectedRbk(rbkList[0] || '');
  }, [selectedState, locationHierarchy]);

  // When mandal changes -> update RBKs
  useEffect(() => {
    if (!selectedState || !selectedMandal) return;
    const rbkList = locationHierarchy[selectedState]?.[selectedMandal] || [];
    setRbks(rbkList);
    setSelectedRbk(rbkList[0] || '');
  }, [selectedMandal, selectedState, locationHierarchy]);

  // --- GeoJSON for choropleth (optional) ---
  const fetchGeoJson = async () => {
    try {
      // Place a districts GeoJSON file at public/districts.geojson (optional)
      const res = await fetch('/districts.geojson');
      if (!res.ok) {
        // if not present, just keep empty - map still renders base tiles
        setGeoJsonData(null);
        return;
      }
      const g = await res.json();
      setGeoJsonData(g);
    } catch (err) {
      console.warn('No district geojson or failed to load it.', err);
      setGeoJsonData(null);
    }
  };

  // --- Firestore: live prediction history subscription ---
  const subscribeHistory = () => {
    try {
      const c = collection(db, 'predictions');
      const q = query(c, orderBy('timestamp', 'desc'), limit(200));
      return onSnapshot(q, (snap) => {
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        setPredictionHistory(items);
      }, (err) => console.error('history onSnapshot err', err));
    } catch (err) {
      console.error('subscribeHistory error', err);
    }
  };

  // Filter history (search + filters)
  useEffect(() => {
    const filtered = predictionHistory.filter(item => {
      if (filterState !== 'All' && item.state !== filterState) return false;
      if (filterSeason !== 'All' && item.season !== filterSeason) return false;
      const q = searchText.trim().toLowerCase();
      if (!q) return true;
      return (
        (item.rbk || '').toLowerCase().includes(q) ||
        (item.mandal || '').toLowerCase().includes(q) ||
        (item.state || '').toLowerCase().includes(q)
      );
    });
    setFilteredHistory(filtered);
  }, [predictionHistory, searchText, filterState, filterSeason]);

  // --- Handle prediction submission ---
  const handlePredict = async (e) => {
    e.preventDefault();
    setLoading(true);
    setPrediction(null);
    setShapValues({});

    try {
      // Call your model API
      const res = await fetch(PREDICT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district: selectedState, // keep naming consistent with your model
          mandal: selectedMandal,
          rbk: selectedRbk,
          season,
          qty: Number(qty),
          farmers: Number(farmers)
        })
      });

      if (!res.ok) throw new Error('Prediction API returned error');

      const json = await res.json();
      // expected { predicted_amount: number, shap_values: { feature: value, ... } }
      const predicted_amount = json.predicted_amount ?? json.amount ?? null;
      const shap_vals = json.shap_values ?? json.shap ?? {};

      setPrediction(predicted_amount);
      setShapValues(shap_vals || {});

      // Save to Firestore
      try {
        await addDoc(collection(db, 'predictions'), {
          state: selectedState,
          mandal: selectedMandal,
          rbk: selectedRbk,
          season,
          qty: Number(qty),
          farmers: Number(farmers),
          amount: predicted_amount,
          shapValues: shap_vals,
          timestamp: new Date().toISOString(),
          userId
        });
      } catch (err) {
        console.warn('Could not save prediction to Firestore:', err);
      }

      setModalMessage('Prediction successful');
      setTimeout(() => setModalMessage(''), 2500);
    } catch (err) {
      console.error('handlePredict error', err);
      setModalMessage('Prediction failed. Check backend.');
      setTimeout(() => setModalMessage(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  // --- Generate PDF report (html -> canvas -> pdf) ---
  const generatePDFReport = async () => {
    if (!prediction) {
      setModalMessage('Generate a prediction first');
      setTimeout(() => setModalMessage(''), 2000);
      return;
    }

    // Build report DOM (keeps main UI untouched)
    const reportEl = document.createElement('div');
    reportEl.style.padding = '24px';
    reportEl.style.fontFamily = 'Inter, sans-serif';
    reportEl.style.width = '1000px';
    const maxShap = Math.max(...Object.values(shapValues || { 0: 0 }));

    reportEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h1 style="font-size:24px; margin:0;">RBK Insight - Prediction Report</h1>
        <div style="font-size:12px; color:#444;">Generated: ${new Date().toLocaleString()}</div>
      </div>
      <hr style="margin:12px 0;" />
      <h2 style="font-size:18px;">Prediction</h2>
      <div style="display:flex; gap:24px; margin-bottom:16px;">
        <div style="flex:1; background:#eef2ff; padding:12px; border-radius:8px;">
          <div style="font-size:12px; color:#374151;">Predicted Amount</div>
          <div style="font-size:26px; font-weight:700; color:#064e3b;">${formatCurrency(prediction)}</div>
        </div>
        <div style="flex:1; background:#f0fdf4; padding:12px; border-radius:8px;">
          <div style="font-size:12px; color:#374151;">Location</div>
          <div style="font-size:14px;">State: ${selectedState}</div>
          <div style="font-size:14px;">Mandal: ${selectedMandal}</div>
          <div style="font-size:14px;">RBK: ${selectedRbk}</div>
        </div>
      </div>

      <h3 style="font-size:16px;">Input Parameters</h3>
      <div style="display:flex; gap:12px; margin-bottom:16px;">
        <div style="background:#fff; padding:8px; border-radius:6px;">Season: ${season}</div>
        <div style="background:#fff; padding:8px; border-radius:6px;">Qty (MTs): ${qty}</div>
        <div style="background:#fff; padding:8px; border-radius:6px;">Farmers: ${farmers}</div>
      </div>

      <h3 style="font-size:16px;">Feature contributions (SHAP)</h3>
      <div style="margin-bottom:12px;">
        ${Object.entries(shapValues || {}).map(([f, v]) => {
          const widthPct = maxShap > 0 ? Math.min(100, (v / maxShap) * 100) : 0;
          return `
            <div style="display:flex; align-items:center; margin-bottom:8px;">
              <div style="width:200px;">${f}</div>
              <div style="flex:1; background:#e6eef8; height:10px; border-radius:6px; margin:0 8px;">
                <div style="height:100%; background:#2563eb; width:${widthPct}%; border-radius:6px;"></div>
              </div>
              <div style="width:60px; text-align:right;">${Number(v).toFixed(2)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    document.body.appendChild(reportEl);
    const canvas = await html2canvas(reportEl, { scale: 2 });
    const pdf = new jsPDF('p', 'mm', 'a4');
    // Fit to A4 (210 x 297 mm) while keeping aspect ratio
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, 210, (canvas.height * 210) / canvas.width);
    pdf.save(`RBK_Prediction_${selectedRbk || 'report'}.pdf`);
    document.body.removeChild(reportEl);
  };

  // --- Trigger backend retrain (your backend must implement) ---
  const triggerRetrain = async () => {
    setModalMessage('Sending retrain request...');
    try {
      const res = await fetch(RETRAIN_ENDPOINT, { method: 'POST' });
      if (!res.ok) throw new Error('Retrain failed');
      setModalMessage('Retrain job started on backend');
    } catch (err) {
      console.error('retrain error', err);
      setModalMessage('Retrain request failed. Check backend.');
    } finally {
      setTimeout(() => setModalMessage(''), 3000);
    }
  };

  // --- Utility: format INR ---
  const formatCurrency = (num) => {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
      .format(num)
      .replace('₹', 'Rs ');
  };

  // --- Map style helper ---
  function getColorForValue(value) {
    if (value > 1000000) return '#005824';
    if (value > 500000) return '#238b45';
    if (value > 100000) return '#41ab5d';
    if (value > 50000) return '#74c476';
    if (value > 10000) return '#a1d99b';
    return '#c7e9c0';
  }

  // --- Create choropleth style ---
  const geoStyle = (feature) => {
    const val = districtTotals[feature?.properties?.name] || 0;
    return {
      fillColor: getColorForValue(val),
      weight: 1,
      opacity: 1,
      color: 'white',
      fillOpacity: 0.8
    };
  };

  // --- onEach feature for popup ---
  const onEachFeature = (feature, layer) => {
    const name = feature?.properties?.name || 'Unknown';
    const val = districtTotals[name] || 0;
    layer.bindPopup(`<b>${name}</b><br/>Total: ${formatCurrency(val)}`);
  };

  // --- SHAP chart data helper ---
  const shapChartData = Object.entries(shapValues || {}).map(([name, value]) => ({
    name,
    value: Number(value)
  })).sort((a,b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 30); // top 30

  // --- Render ---
  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header */}
      <header className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">RBK Insight Portal</h1>
            <p className="text-sm opacity-75">Predict Amount (Rs) for an RBK — interactive dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setDarkMode(!darkMode); localStorage.setItem('rbk:dark', String(!darkMode)); }}
              className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
              title="Toggle theme"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button onClick={triggerRetrain} className="px-3 py-1 bg-yellow-500 rounded text-white flex items-center gap-2">
              <Repeat size={16} /> Retrain
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left - form & SHAP */}
          <div className="lg:col-span-1 space-y-6">
            <div className={`p-6 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow`}>
              <h2 className="text-lg font-semibold mb-4">Make Prediction</h2>
              <form onSubmit={handlePredict} className="space-y-3">
                <div>
                  <label className="block text-xs mb-1">State / District</label>
                  <select className="w-full p-2 border rounded" value={selectedState} onChange={(e) => setSelectedState(e.target.value)} required>
                    <option value="">Select State</option>
                    {states.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs mb-1">Mandal</label>
                  <select className="w-full p-2 border rounded" value={selectedMandal} onChange={(e) => setSelectedMandal(e.target.value)} disabled={!selectedState} required>
                    <option value="">Select Mandal</option>
                    {mandals.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs mb-1">RBK</label>
                  <select className="w-full p-2 border rounded" value={selectedRbk} onChange={(e) => setSelectedRbk(e.target.value)} disabled={!selectedMandal} required>
                    <option value="">Select RBK</option>
                    {rbks.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs mb-1">Season</label>
                  <select className="w-full p-2 border rounded" value={season} onChange={(e) => setSeason(e.target.value)} required>
                    <option value="Kharif">Kharif</option>
                    <option value="Rabi">Rabi</option>
                    <option value="Summer">Summer</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs mb-1">Quantity (MTs)</label>
                  <input className="w-full p-2 border rounded" type="number" step="0.01" min="0" value={qty} onChange={(e) => setQty(e.target.value)} required />
                </div>

                <div>
                  <label className="block text-xs mb-1">No. of Farmers</label>
                  <input className="w-full p-2 border rounded" type="number" min="0" value={farmers} onChange={(e) => setFarmers(e.target.value)} required />
                </div>

                <div className="pt-2">
                  <button type="submit" disabled={loading} className={`w-full py-2 rounded font-medium ${loading ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
                    {loading ? 'Predicting...' : 'Predict Amount'}
                  </button>
                </div>
              </form>
            </div>

            {/* SHAP chart */}
            <div className={`p-6 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow`}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold">SHAP Explanations</h3>
                <button onClick={() => { setShapValues({}); setModalMessage('Cleared SHAP'); setTimeout(()=>setModalMessage(''),1500); }} className="text-sm">Clear</button>
              </div>

              {Object.keys(shapValues || {}).length === 0 ? (
                <div className="text-sm text-gray-500">SHAP values will appear after prediction.</div>
              ) : (
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={shapChartData}>
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="name" width={160} />
                      <Tooltip formatter={(v) => v.toFixed ? v.toFixed(2) : v} />
                      <Bar dataKey="value" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Right - main dashboard */}
          <div className="lg:col-span-3 space-y-6">
            {/* Result card */}
            <div className={`p-6 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow flex justify-between items-center`}>
              <div>
                <h2 className="text-xl font-semibold">Prediction Result</h2>
                {prediction ? (
                  <div className="mt-2">
                    <div className="text-sm text-gray-500">Predicted Amount for</div>
                    <div className="text-3xl font-bold text-blue-600">{formatCurrency(prediction)}</div>
                    <div className="text-sm text-gray-500 mt-1">{selectedState} → {selectedMandal} → {selectedRbk}</div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 mt-2">Submit the form to generate a prediction</div>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={generatePDFReport} disabled={!prediction} className="flex items-center gap-2 px-3 py-2 bg-gray-200 rounded">
                  <FileText size={16} /> Export PDF
                </button>
                <button onClick={() => { navigator.clipboard?.writeText(JSON.stringify({state:selectedState,mandal:selectedMandal,rbk:selectedRbk,season,qty,farmers})); setModalMessage('Copied JSON to clipboard'); setTimeout(()=>setModalMessage(''),1500); }} className="flex items-center gap-2 px-3 py-2 bg-gray-200 rounded">
                  <Download size={16} /> Copy JSON
                </button>
              </div>
            </div>

            {/* Choropleth map */}
            <div className={`p-6 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow`}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold">District-wise Allocation (Choropleth)</h3>
                <div className="text-sm text-gray-500">Values come from prediction aggregation</div>
              </div>

              <div className="h-96 rounded overflow-hidden">
                <MapContainer center={[17.3850, 78.4867]} zoom={6} style={{ height: '100%', width: '100%' }}>
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; OpenStreetMap contributors'
                  />
                  {geoJsonData && <GeoJSON data={geoJsonData} style={geoStyle} onEachFeature={onEachFeature} />}
                </MapContainer>
              </div>
            </div>

            {/* History & filters */}
            <div className={`p-6 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow`}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold">Prediction History</h3>
                <div className="flex gap-2 items-center">
                  <div className="flex items-center border rounded overflow-hidden">
                    <input className="p-2 outline-none" placeholder="Search RBK / Mandal / State" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
                    <div className="px-2"><Search size={16} /></div>
                  </div>

                  <select className="p-2 border rounded" value={filterState} onChange={(e) => setFilterState(e.target.value)}>
                    <option value="All">All States</option>
                    {states.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>

                  <select className="p-2 border rounded" value={filterSeason} onChange={(e) => setFilterSeason(e.target.value)}>
                    <option value="All">All Seasons</option>
                    <option value="Kharif">Kharif</option>
                    <option value="Rabi">Rabi</option>
                    <option value="Summer">Summer</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase">RBK</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase">Location</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredHistory.length === 0 ? (
                      <tr><td colSpan={4} className="p-4 text-center text-sm text-gray-500">No history</td></tr>
                    ) : filteredHistory.map(rec => (
                      <tr key={rec.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm">{new Date(rec.timestamp).toLocaleString()}</td>
                        <td className="px-4 py-2 text-sm">{rec.rbk}</td>
                        <td className="px-4 py-2 text-sm">{rec.state} → {rec.mandal}</td>
                        <td className="px-4 py-2 text-sm font-medium">{formatCurrency(rec.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* small modal notifications */}
      {modalMessage && (
        <div className="fixed bottom-6 right-6 px-4 py-2 bg-blue-600 text-white rounded shadow">
          {modalMessage}
        </div>
      )}
    </div>
  );
}
