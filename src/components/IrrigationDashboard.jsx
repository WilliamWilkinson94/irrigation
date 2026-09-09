import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import Editor from '@monaco-editor/react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Play, Power, Droplets, Sliders, Calendar as CalendarIcon, Code } from 'lucide-react';

const SOCKET_SERVER_URL = 'http://localhost:8080';

const DEFAULT_ESP32_CODE = `// ESP32 Automated Irrigation Sketch
#include <WiFi.h>

const int SOIL_PIN = 34;
const int SOLENOID_1_PIN = 26;
int threshold = 300;

void setup() {
  Serial.begin(115200);
  pinMode(SOLENOID_1_PIN, OUTPUT);
}

void loop() {
  int moisture = analogRead(SOIL_PIN);
  if (moisture < threshold) {
    digitalWrite(SOLENOID_1_PIN, HIGH); // Turn On
  } else {
    digitalWrite(SOLENOID_1_PIN, LOW);  // Turn Off
  }
  delay(2000);
}`;

export default function IrrigationDashboard() {
  const [socket, setSocket] = useState(null);
  const [solenoids, setSolenoids] = useState({ solenoidOne: false, solenoidTwo: false });
  const [threshold, setThreshold] = useState(300);
  const [newThresholdInput, setNewThresholdInput] = useState('');
  
  // Monaco & Firmware State
  const [code, setCode] = useState(DEFAULT_ESP32_CODE);
  const [revisions, setRevisions] = useState([]);
  const [selectedRevision, setSelectedRevision] = useState('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileStatus, setCompileStatus] = useState('');

  // Calendar State
  const [schedules, setSchedules] = useState([]);

  useEffect(() => {
    const s = io(SOCKET_SERVER_URL);
    setSocket(s);

    s.on('state:init', (data) => {
      setThreshold(data.threshold);
      setSolenoids(data.solenoids);
      setSchedules(data.schedules);
      setRevisions(data.revisions);
    });

    s.on('solenoid:updated', (updatedSolenoids) => setSolenoids(updatedSolenoids));
    s.on('threshold:updated', (updatedThreshold) => setThreshold(updatedThreshold));
    s.on('schedules:updated', (updatedSchedules) => setSchedules(updatedSchedules));
    s.on('revisions:updated', (updatedRevisions) => setRevisions(updatedRevisions));

    return () => s.disconnect();
  }, []);

  // --- ACTUATOR & THRESHOLD HANDLERS ---
  const toggleSolenoid = (target) => {
    if (!socket) return;
    socket.emit('solenoid:toggle', { target, state: !solenoids[target] });
  };

  const handleAllOff = () => {
    if (!socket) return;
    socket.emit('solenoid:all_off');
  };

  const handleUpdateThreshold = (e) => {
    e.preventDefault();
    if (!socket || !newThresholdInput) return;
    socket.emit('threshold:update', newThresholdInput);
    setNewThresholdInput('');
  };

  // --- FIRMWARE COMPILATION & ROLLBACK HANDLERS ---
  const handleCompileAndUpload = async () => {
    setIsCompiling(true);
    setCompileStatus('Compiling C++ sketch with arduino-cli...');

    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/firmware/compile-and-flash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: code })
      });
      const data = await res.json();

      if (res.ok) {
        setCompileStatus(`Success! Snapshot ${data.versionTag} created and flash queued.`);
      } else {
        setCompileStatus(`Error: ${data.details || data.error}`);
      }
    } catch (err) {
      setCompileStatus('Failed to communicate with build server.');
    } finally {
      setIsCompiling(false);
    }
  };

  const handleRollbackSelect = async (revisionId) => {
    setSelectedRevision(revisionId);
    if (!revisionId) return;

    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/firmware/revisions/${revisionId}`);
      const data = await res.json();
      if (res.ok) {
        setCode(data.code);
        setCompileStatus(`Loaded revision ${data.versionTag} into editor.`);
      }
    } catch (err) {
      console.error('Error fetching revision:', err);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#f4f6f8', minHeight: '100vh' }}>
      <h2>Irrigation Web Dashboard V4</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: '20px' }}>
        
        {/* COLUMN 1: LIVE HARDWARE CONTROLS */}
        <div style={cardStyle}>
          <h3><Droplets size={20} /> Manual Actuator Controls</h3>
          
          <div style={{ marginBottom: '15px' }}>
            <label><strong>Solenoid One:</strong></label>
            <button 
              onClick={() => toggleSolenoid('solenoidOne')}
              style={solenoids.solenoidOne ? activeBtn : inactiveBtn}>
              {solenoids.solenoidOne ? 'ON' : 'OFF'}
            </button>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label><strong>Solenoid Two:</strong></label>
            <button 
              onClick={() => toggleSolenoid('solenoidTwo')}
              style={solenoids.solenoidTwo ? activeBtn : inactiveBtn}>
              {solenoids.solenoidTwo ? 'ON' : 'OFF'}
            </button>
          </div>

          <button onClick={handleAllOff} style={dangerBtn}>
            <Power size={16} /> ALL OFF
          </button>

          <hr style={{ margin: '20px 0' }} />

          <h3><Sliders size={20} /> Moisture Threshold</h3>
          <p>Current Threshold: <strong>{threshold}</strong></p>
          <form onSubmit={handleUpdateThreshold}>
            <input 
              type="number" 
              placeholder="Integer 0-450" 
              value={newThresholdInput}
              onChange={(e) => setNewThresholdInput(e.target.value)}
              style={{ padding: '8px', marginRight: '10px', width: '120px' }}
            />
            <button type="submit" style={primaryBtn}>Set Threshold</button>
          </form>
        </div>

        {/* COLUMN 2: CALENDAR SCHEDULE & LOGS */}
        <div style={cardStyle}>
          <h3><CalendarIcon size={20} /> Waterings & Events</h3>
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{ left: 'prev,next', center: 'title', right: 'timeGridWeek,dayGridMonth' }}
            events={schedules.map(s => ({
              id: s.id,
              title: s.title,
              start: s.start,
              backgroundColor: s.type === 'past' ? '#6c757d' : '#28a745'
            }))}
            height="420px"
          />
        </div>

        {/* COLUMN 3: MONACO EDITOR & FIRMWARE REVISIONS */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3><Code size={20} /> ESP32 C++ Firmware Editor</h3>
            
            {/* Version Revision Dropdown */}
            <select 
              value={selectedRevision} 
              onChange={(e) => handleRollbackSelect(e.target.value)}
              style={{ padding: '6px' }}
            >
              <option value="">-- Revert to Revision --</option>
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.versionTag} ({new Date(r.timestamp).toLocaleTimeString()})
                </option>
              ))}
            </select>
          </div>

          <div style={{ border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}>
            <Editor
              height="300px"
              defaultLanguage="cpp"
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value || '')}
              options={{ minimap: { enabled: false }, fontSize: 13 }}
            />
          </div>

          <div style={{ marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button 
              onClick={handleCompileAndUpload} 
              disabled={isCompiling} 
              style={isCompiling ? disabledBtn : primaryBtn}
            >
              <Play size={16} /> {isCompiling ? 'Compiling...' : 'Compile & Flash (OTA)'}
            </button>
          </div>

          {compileStatus && (
            <p style={{ marginTop: '8px', fontSize: '12px', color: compileStatus.startsWith('Error') ? 'red' : 'green' }}>
              {compileStatus}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}

// Inline Styles
const cardStyle = { backgroundColor: '#fff', padding: '16px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' };
const activeBtn = { padding: '8px 16px', marginLeft: '10px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' };
const inactiveBtn = { padding: '8px 16px', marginLeft: '10px', backgroundColor: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' };
const primaryBtn = { padding: '8px 16px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' };
const dangerBtn = { padding: '10px 20px', backgroundColor: '#343a40', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' };
const disabledBtn = { ...primaryBtn, backgroundColor: '#6c757d', cursor: 'not-allowed' };
