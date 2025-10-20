/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, useMemo, FormEvent, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './index.css';

interface Device {
  name: string;
  model: string;
  serialNumber: string;
  department: string;
  expiryDate: string;
  imageUrl?: string;
}

interface ImportResults {
  added: number;
  updated: number;
  skipped: Array<{ row: number; reason:string; data: string }>;
}

const ITEMS_PER_PAGE = 10;
const QR_CODE_DATA_LIMIT = 2500; // In bytes

const formatDateForDisplay = (isoDate: string): string => {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
};

const MultiSelectDropdown = ({ options, selected, onChange, placeholder }: { options: string[], selected: string[], onChange: (selected: string[]) => void, placeholder: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOptionToggle = (option: string) => {
    const newSelected = selected.includes(option)
      ? selected.filter(item => item !== option)
      : [...selected, option];
    onChange(newSelected);
  };

  const filteredOptions = options.filter(option => 
    option.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getDisplayText = () => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) return selected[0];
    if (selected.length === options.length) return 'All Departments';
    return `${selected.length} departments selected`;
  };

  return (
    <div className="multi-select-container" ref={dropdownRef}>
      <button type="button" className="multi-select-display" onClick={() => setIsOpen(!isOpen)}>
        {getDisplayText()}
        <span className="multi-select-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="multi-select-dropdown">
          <input
            type="text"
            className="multi-select-search"
            placeholder="Search departments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <ul className="multi-select-list">
            {filteredOptions.length > 0 ? filteredOptions.map(option => (
              <li key={option} className="multi-select-item">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => handleOptionToggle(option)}
                  />
                  {option}
                </label>
              </li>
            )) : (
              <li className="multi-select-no-results">No departments found.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};


const App = () => {
  const [devices, setDevices] = useState<Device[]>(() => {
    try {
      const savedDevices = localStorage.getItem('biomedical-devices');
      return savedDevices ? JSON.parse(savedDevices) : [];
    } catch (error) {
      console.error('Failed to load devices from localStorage', error);
      return [];
    }
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deviceToDelete, setDeviceToDelete] = useState<Device | null>(null);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Device; direction: 'asc' | 'desc' } | null>({ key: 'expiryDate', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [importResults, setImportResults] = useState<ImportResults | null>(null);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [jsonToImport, setJsonToImport] = useState<string | null>(null);

  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('biomedical-devices', JSON.stringify(devices));
    } catch (error) {
      console.error('Failed to save devices to localStorage', error);
    }
  }, [devices]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDepartments, searchQuery]);

  const departments = useMemo(() => [...new Set(devices.map((d) => d.department))].sort(), [devices]);

  const filteredAndSortedDevices = useMemo(() => {
    let filtered = [...devices];
    
    if (searchQuery) {
        const lowercasedQuery = searchQuery.toLowerCase();
        filtered = filtered.filter(device =>
            device.name.toLowerCase().includes(lowercasedQuery) ||
            device.model.toLowerCase().includes(lowercasedQuery) ||
            device.serialNumber.toLowerCase().includes(lowercasedQuery)
        );
    }

    if (selectedDepartments.length > 0) {
      filtered = filtered.filter((device) => selectedDepartments.includes(device.department));
    }
    
    if (sortConfig !== null) {
      filtered.sort((a, b) => {
        if (sortConfig.key === 'imageUrl') return 0; // Don't sort by image
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return filtered;
  }, [devices, selectedDepartments, sortConfig, searchQuery]);
  
  const paginatedDevices = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedDevices.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredAndSortedDevices, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedDevices.length / ITEMS_PER_PAGE);

  const handleSort = (key: keyof Device) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  const handleExportCSV = () => {
    if (filteredAndSortedDevices.length === 0) {
      alert('No data to export.');
      return;
    }

    const headers = ['Name', 'Model', 'Serial Number', 'Department', 'Expiry Date'];
    const keys: (keyof Device)[] = ['name', 'model', 'serialNumber', 'department', 'expiryDate'];

    const csvContent = [
      headers.join(','),
      ...filteredAndSortedDevices.map(device => 
        keys.map(key => {
          let value = device[key];
          if (key === 'expiryDate' && typeof value === 'string') {
            value = formatDateForDisplay(value);
          }
          return `"${String(value ?? '').replace(/"/g, '""')}"`;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'biomedical_devices_export.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handleExportPDF = () => {
    if (filteredAndSortedDevices.length === 0) {
      alert('No data to export.');
      return;
    }

    const doc = new jsPDF();
    const head = [['Name', 'Model', 'Serial Number', 'Department', 'Expiry Date']];
    const body = filteredAndSortedDevices.map(device => [
      device.name,
      device.model,
      device.serialNumber,
      device.department,
      formatDateForDisplay(device.expiryDate)
    ]);

    doc.setFontSize(18);
    doc.text('Biomedical Device Report', 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 29);

    autoTable(doc, {
      startY: 35,
      head: head,
      body: body,
      theme: 'striped',
      headStyles: { fillColor: [0, 123, 255] },
    });

    doc.save('biomedical_devices_report.pdf');
  };

  const handleExportJSON = () => {
    if (devices.length === 0) {
      alert('No data to export.');
      return;
    }
    const jsonContent = JSON.stringify(devices, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'biomedical_devices_backup.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadTemplate = () => {
    const headers = ['Name', 'Model', 'Serial Number', 'Department', 'Expiry Date'];
    const csvContent = headers.join(',');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'import_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handleImportCSVClick = () => {
    csvFileInputRef.current?.click();
  };

  const handleJSONFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
            setJsonToImport(text);
        } else {
            alert('File is empty or cannot be read.');
        }
    };
    reader.onerror = () => {
        alert('Failed to read the file.');
    };
    reader.readAsText(file);
    event.target.value = '';
  };
  
  const confirmAndImportData = (jsonData: string) => {
    try {
        const importedDevices: Device[] = JSON.parse(jsonData);
        if (!Array.isArray(importedDevices) || importedDevices.some(d =>
            typeof d.name !== 'string' ||
            typeof d.serialNumber !== 'string' ||
            typeof d.expiryDate !== 'string'
        )) {
            throw new Error('Invalid file structure.');
        }
        setDevices(importedDevices);
        return true;
    } catch (error) {
        return false;
    }
  };

  const handleConfirmJSONImport = () => {
    if (!jsonToImport) return;
    if (confirmAndImportData(jsonToImport)) {
        setJsonToImport(null);
        setIsSyncModalOpen(false); // Close sync modal on success
        alert('Data successfully imported.');
    } else {
        alert('Invalid JSON format or structure. Please use a valid backup file.');
        setJsonToImport(null);
    }
  };

  const handleCSVImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      alert('Please select a valid CSV file.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        alert('File is empty or cannot be read.');
        return;
      }
      const rows = text.split('\n').map(row => row.trim()).filter(Boolean);
      if (rows.length < 2) {
        alert('CSV file must contain a header and at least one data row.');
        return;
      }
      const parseCsvRow = (row: string): string[] => {
          return row.split(',').map(field => field.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
      };
      const header = parseCsvRow(rows[0]);
      const requiredHeaders = ['Name', 'Model', 'Serial Number', 'Department', 'Expiry Date'];
      const headerIndices: { [key: string]: number } = {};
      const missingHeaders: string[] = [];
      requiredHeaders.forEach(h => {
          const index = header.indexOf(h);
          if (index === -1) {
              missingHeaders.push(h);
          } else {
              headerIndices[h] = index;
          }
      });
      if (missingHeaders.length > 0) {
          alert(`CSV file is missing required headers: ${missingHeaders.join(', ')}.`);
          return;
      }
      let updatedCount = 0;
      let addedCount = 0;
      const skippedRows: Array<{ row: number; reason: string; data: string }> = [];
      const devicesMap: Map<string, Device> = new Map(devices.map(device => [device.serialNumber, { ...device }]));
      const processedSerialNumbersInFile = new Set<string>();
      for (let i = 1; i < rows.length; i++) {
        const currentRowNumber = i + 1;
        const originalRowData = rows[i];
        const values = parseCsvRow(originalRowData);
        const serialNumber = values[headerIndices['Serial Number']];
        if (!serialNumber) {
          skippedRows.push({ row: currentRowNumber, reason: 'Missing Serial Number', data: originalRowData });
          continue;
        }
        if (processedSerialNumbersInFile.has(serialNumber)) {
          skippedRows.push({ row: currentRowNumber, reason: 'Duplicate serial number in file', data: originalRowData });
          continue;
        }
        processedSerialNumbersInFile.add(serialNumber);
        const name = values[headerIndices['Name']];
        const model = values[headerIndices['Model']];
        const department = values[headerIndices['Department']];
        const expiryDateStr = values[headerIndices['Expiry Date']];
        let formattedExpiryDate: string | undefined = undefined;
        let isDateInvalid = false;
        if (expiryDateStr) {
            const parts = expiryDateStr.split(/[-/]/);
            if (parts.length === 3) {
                const [dayStr, monthStr, yearStr] = parts;
                const day = parseInt(dayStr, 10);
                const month = parseInt(monthStr, 10);
                const year = parseInt(yearStr, 10);
                if (!isNaN(day) && !isNaN(month) && !isNaN(year) && day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 9999) {
                    const parsedDate = new Date(Date.UTC(year, month - 1, day));
                    if (parsedDate.getUTCFullYear() === year && parsedDate.getUTCMonth() === month - 1 && parsedDate.getUTCDate() === day) {
                        formattedExpiryDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    } else { isDateInvalid = true; }
                } else { isDateInvalid = true; }
            } else { isDateInvalid = true; }
        }
        const isNewDevice = !devicesMap.has(serialNumber);
        if (isNewDevice) {
            if (!name || !model || !department || !expiryDateStr) {
                skippedRows.push({ row: currentRowNumber, reason: 'Missing required fields for new device', data: originalRowData });
                continue;
            }
            if (isDateInvalid) {
                skippedRows.push({ row: currentRowNumber, reason: 'Invalid date format (expected dd-MM-yyyy)', data: originalRowData });
                continue;
            }
        } else {
            if (expiryDateStr && isDateInvalid) {
                skippedRows.push({ row: currentRowNumber, reason: 'Invalid date format (expected dd-MM-yyyy)', data: originalRowData });
                continue;
            }
        }
        if (isNewDevice) {
            devicesMap.set(serialNumber, {
                serialNumber, name: name!, model: model!, department: department!, expiryDate: formattedExpiryDate!,
            });
            addedCount++;
        } else {
            const device = devicesMap.get(serialNumber)!;
            if (name) device.name = name;
            if (model) device.model = model;
            if (department) device.department = department;
            if (formattedExpiryDate) device.expiryDate = formattedExpiryDate;
            devicesMap.set(serialNumber, device);
            updatedCount++;
        }
      }
      setDevices(Array.from(devicesMap.values()));
      setImportResults({ added: addedCount, updated: updatedCount, skipped: skippedRows });
    };
    reader.onerror = () => {
      alert('Failed to read the file.');
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const openModal = (device: Device | null = null) => {
    setEditingDevice(device);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingDevice(null);
  };

  const handleSaveDevice = (device: Device) => {
    if (editingDevice) {
      setDevices(devices.map((d) => (d.serialNumber === editingDevice.serialNumber ? device : d)));
    } else {
      if (devices.some(d => d.serialNumber === device.serialNumber)) {
        alert('A device with this serial number already exists.');
        return;
      }
      setDevices([...devices, device]);
    }
    closeModal();
  };

  const handleConfirmDelete = () => {
    if (deviceToDelete) {
      setDevices(devices.filter((d) => d.serialNumber !== deviceToDelete.serialNumber));
      setDeviceToDelete(null);
    }
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedDepartments([]);
  };

  const getExpiryStatus = (dateString: string): string => {
    const today = new Date();
    const expiryDate = new Date(dateString);
    today.setHours(0, 0, 0, 0);
    expiryDate.setHours(0, 0, 0, 0);
    const diffTime = expiryDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'status-expired';
    if (diffDays <= 7) return 'status-urgent';
    if (diffDays <= 30) return 'status-soon';
    return 'status-ok';
  };
  
  const sortableKeys: Array<keyof Device> = ['name', 'model', 'serialNumber', 'expiryDate'];
  const headerKeys: Array<keyof Device> = ['name', 'model', 'serialNumber', 'department', 'expiryDate'];
  const isFiltered = searchQuery || selectedDepartments.length > 0;

  return (
    <div className="container">
      <header className="app-header">
        <div className="header-title-container">
          <img src="https://i.ibb.co/LzdYpK2/image.png" alt="Haria L.G. Rotary Hospital Logo" className="app-logo" />
          <h1>Biomedical Device Maintenance Tracker</h1>
        </div>
        <div className="header-actions">
           <input type="file" ref={csvFileInputRef} onChange={handleCSVImport} style={{ display: 'none' }} accept=".csv, text/csv" />
            <input type="file" ref={jsonFileInputRef} onChange={handleJSONFileChange} style={{ display: 'none' }} accept="application/json" />
           <DataManagementDropdown 
             onImportCSV={handleImportCSVClick}
             onExportCSV={handleExportCSV}
             onExportPDF={handleExportPDF}
             onSync={() => setIsSyncModalOpen(true)}
             onDownloadTemplate={handleDownloadTemplate}
           />
          <button onClick={() => openModal()} className="btn-primary"> Add New Device </button>
        </div>
      </header>
      
      <div className="info-banner">
        <span>💡 Data is saved locally. Use 'Data Management' to sync between devices.</span>
        <button onClick={() => setIsInfoModalOpen(true)} className="info-learn-more">Learn More</button>
      </div>

      <div className="controls">
         <input type="text" placeholder="Search by name, model, or serial number..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="search-input" />
        <MultiSelectDropdown options={departments} selected={selectedDepartments} onChange={setSelectedDepartments} placeholder="All Departments" />
        {isFiltered && ( <button onClick={handleClearFilters} className="btn-tertiary"> Clear Filters </button> )}
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Image</th>
              {headerKeys.map((key) => {
                const isSortable = sortableKeys.includes(key);
                return (
                  <th key={key} className={isSortable ? 'sortable' : ''} onClick={isSortable ? () => handleSort(key) : undefined} >
                    {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                    {isSortable && sortConfig?.key === key && (sortConfig.direction === 'asc' ? ' ▲' : ' ▼')}
                  </th>
                );
              })}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedDevices.length > 0 ? (
              paginatedDevices.map((device) => (
                <tr key={device.serialNumber} className={getExpiryStatus(device.expiryDate)}>
                  <td>
                    {device.imageUrl ? ( <img src={device.imageUrl} alt={device.name} className="device-thumbnail" /> ) : ( <span className="no-image-placeholder">📷</span> )}
                  </td>
                  <td>{device.name}</td>
                  <td>{device.model}</td>
                  <td>{device.serialNumber}</td>
                  <td>{device.department}</td>
                  <td> <span className={`status-pill ${getExpiryStatus(device.expiryDate)}`}> {formatDateForDisplay(device.expiryDate)} </span> </td>
                  <td className="actions">
                    <button onClick={() => openModal(device)} className="btn-icon"> ✏️ </button>
                    <button onClick={() => setDeviceToDelete(device)} className="btn-icon"> 🗑️ </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="no-data">
                  {isFiltered ? 'No devices match the current filters.' : 'No devices found. Add a new device to get started.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

       <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {isModalOpen && <DeviceModal device={editingDevice} onSave={handleSaveDevice} onClose={closeModal} />}
      {deviceToDelete && ( <ConfirmationModal device={deviceToDelete} onConfirm={handleConfirmDelete} onClose={() => setDeviceToDelete(null)} /> )}
      {importResults && ( <ImportResultModal results={importResults} onClose={() => setImportResults(null)} /> )}
      {isInfoModalOpen && <DataSyncInfoModal onClose={() => setIsInfoModalOpen(false)} />}
      {isSyncModalOpen && <DataSyncModal devices={devices} onClose={() => setIsSyncModalOpen(false)} onImportByFile={() => jsonFileInputRef.current?.click()} onExportByFile={handleExportJSON} onDataReceived={setJsonToImport} />}
      {jsonToImport && ( <ConfirmJSONImportModal onConfirm={handleConfirmJSONImport} onClose={() => setJsonToImport(null)} /> )}
    </div>
  );
};

const DataManagementDropdown = ({ onImportCSV, onExportCSV, onExportPDF, onSync, onDownloadTemplate }: { onImportCSV: () => void, onExportCSV: () => void, onExportPDF: () => void, onSync: () => void, onDownloadTemplate: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className="dropdown-container" ref={dropdownRef}>
      <button onClick={() => setIsOpen(!isOpen)} className="btn-secondary"> Data Management {isOpen ? '▲' : '▼'} </button>
      {isOpen && (
        <div className="dropdown-menu">
          <button onClick={() => handleAction(onSync)}>Sync / Transfer Data</button>
          <hr />
          <button onClick={() => handleAction(onImportCSV)}>Import from CSV</button>
          <button onClick={() => handleAction(onExportCSV)}>Export to CSV</button>
          <button onClick={() => handleAction(onExportPDF)}>Export to PDF</button>
          <button onClick={() => handleAction(onDownloadTemplate)}>Download CSV Template</button>
        </div>
      )}
    </div>
  );
};


const Pagination = ({ currentPage, totalPages, onPageChange }: { currentPage: number, totalPages: number, onPageChange: (page: number) => void}) => {
  if (totalPages <= 1) return null;
  const handlePrev = () => { onPageChange(Math.max(currentPage - 1, 1)); };
  const handleNext = () => { onPageChange(Math.min(currentPage + 1, totalPages)); };
  return (
    <div className="pagination-container">
      <button onClick={handlePrev} disabled={currentPage === 1} className="pagination-btn"> &laquo; Previous </button>
      <span> Page {currentPage} of {totalPages} </span>
      <button onClick={handleNext} disabled={currentPage === totalPages} className="pagination-btn"> Next &raquo; </button>
    </div>
  );
};


const DeviceModal = ({ device, onSave, onClose }: { device: Device | null; onSave: (device: Device) => void; onClose: () => void; }) => {
  const [formData, setFormData] = useState<Device>( device || { name: '', model: '', serialNumber: '', department: '', expiryDate: '', imageUrl: '' } );
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        alert('Invalid file type. Please select a valid image file (JPEG, PNG, GIF, WEBP).');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, imageUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [year, month, day] = formData.expiryDate.split('-').map(Number);
    const selectedDate = new Date(year, month - 1, day);
    if (selectedDate < today) {
      alert("The expiry date cannot be in the past. Please select today or a future date.");
      return;
    }
    onSave(formData);
  };
  const today = new Date().toISOString().split('T')[0];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>{device ? 'Edit Device' : 'Add New Device'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group"> <label>Device Name</label> <input name="name" value={formData.name} onChange={handleChange} required /> </div>
          <div className="form-group"> <label>Model</label> <input name="model" value={formData.model} onChange={handleChange} required /> </div>
          <div className="form-group"> <label>Serial Number</label> <input name="serialNumber" value={formData.serialNumber} onChange={handleChange} required disabled={!!device} /> </div>
          <div className="form-group"> <label>Department</label> <input name="department" value={formData.department} onChange={handleChange} required /> </div>
          <div className="form-group">
            <label>Device Image</label>
            <input type="file" name="image" onChange={handleImageChange} accept="image/*" />
            {formData.imageUrl && ( <img src={formData.imageUrl} alt="Preview" className="image-preview" /> )}
          </div>
          <div className="form-group"> <label>AMC/Maintenance Expiry</label> <input type="date" name="expiryDate" value={formData.expiryDate} onChange={handleChange} required min={today} /> </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Save Device</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ConfirmationModal = ({ device, onConfirm, onClose }: { device: Device, onConfirm: () => void, onClose: () => void }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Confirm Deletion</h2>
        <div className="confirmation-body">
          <p> Are you sure you want to permanently delete this device? <br /> <strong>{device.name} (S/N: {device.serialNumber})</strong> </p>
          <p className="warning-text">This action cannot be undone.</p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={onConfirm} className="btn-danger">Delete</button>
        </div>
      </div>
    </div>
  );
};

const ConfirmJSONImportModal = ({ onConfirm, onClose }: { onConfirm: () => void, onClose: () => void }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Confirm Data Import</h2>
        <div className="confirmation-body">
          <p className="warning-text-strong"> Warning: This will overwrite all currently saved data in your browser. </p>
          <p> Are you sure you want to proceed? This action cannot be undone. </p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={onConfirm} className="btn-danger">Overwrite and Import</button>
        </div>
      </div>
    </div>
  );
};

const DataSyncInfoModal = ({ onClose }: { onClose: () => void }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>How Your Data is Saved & Synced</h2>
        <div className="info-modal-body">
            <p><strong>Your data is stored locally in this web browser.</strong> It is not saved to a central cloud server.</p>
            <ul>
                <li>Data added here will <strong>only</strong> be visible on this device and in this browser.</li>
                <li>Clearing your browser's data will permanently delete your device list.</li>
            </ul>
            <h4>How to Sync Data Between Devices:</h4>
            <ol>
                <li>On the device with your data, go to <strong>Data Management &gt; Sync / Transfer Data</strong> and select the "Share" tab to display a QR code.</li>
                <li>On your second device, open the same menu, select the "Receive" tab and click <strong>Scan QR Code</strong> to use the camera.</li>
                <li>Scan the code from the first device to instantly transfer all data.</li>
            </ol>
            <p>For large datasets, you can use the fallback "Download" and "Upload" file options in the same dialog.</p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-primary">Got it</button>
        </div>
      </div>
    </div>
  );
};

const DataSyncModal = ({ devices, onClose, onImportByFile, onExportByFile, onDataReceived }: { devices: Device[], onClose: () => void, onImportByFile: () => void, onExportByFile: () => void, onDataReceived: (data: string) => void }) => {
  const [activeTab, setActiveTab] = useState<'receive' | 'share'>('receive');
  const [isScanning, setIsScanning] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const dataAsString = JSON.stringify(devices);
  const isDataTooLarge = dataAsString.length > QR_CODE_DATA_LIMIT;

  useEffect(() => {
    if (activeTab === 'share' && qrCanvasRef.current && !isDataTooLarge) {
      QRCode.toCanvas(qrCanvasRef.current, dataAsString, { errorCorrectionLevel: 'L', width: 256 });
    }
  }, [activeTab, dataAsString, isDataTooLarge]);

  useEffect(() => {
    if (isScanning) {
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      const qrScanner = new Html5Qrcode('qr-reader');
      scannerRef.current = qrScanner;
      qrScanner.start({ facingMode: 'environment' }, config, 
        (decodedText) => {
          onDataReceived(decodedText);
          stopScanner();
        },
        (errorMessage) => { /* ignore errors */ }
      ).catch(err => {
        console.error("Unable to start scanning.", err);
        setIsScanning(false);
      });
    }
    return () => { stopScanner(); };
  }, [isScanning]);

  const stopScanner = () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      scannerRef.current.stop();
    }
    scannerRef.current = null;
    setIsScanning(false);
  };

  const handleStartScan = () => {
    Html5Qrcode.getCameras().then(() => setIsScanning(true)).catch(() => alert('Could not find a camera on this device.'));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Sync / Transfer Data</h2>
        <div className="sync-tabs">
          <button className={activeTab === 'receive' ? 'active' : ''} onClick={() => setActiveTab('receive')}>Receive</button>
          <button className={activeTab === 'share' ? 'active' : ''} onClick={() => setActiveTab('share')}>Share</button>
        </div>
        <div className="sync-content">
          {activeTab === 'receive' && (
            <div>
              <p>Scan a QR code from another device or upload a JSON file to import data.</p>
              <div className="sync-actions">
                {isScanning ? (
                  <>
                    <div id="qr-reader"></div>
                    <button onClick={stopScanner} className="btn-secondary">Cancel Scan</button>
                  </>
                ) : (
                  <>
                    <button onClick={handleStartScan} className="btn-primary">Scan QR Code</button>
                    <button onClick={onImportByFile} className="btn-secondary">Upload JSON File</button>
                  </>
                )}
              </div>
            </div>
          )}
          {activeTab === 'share' && (
            <div>
              <p>Show this QR code to another device to transfer data instantly.</p>
              <div className="qr-code-container">
                {isDataTooLarge ? (
                  <p className="warning-text">Data size is too large for a QR code. Please use the file download method instead.</p>
                ) : (
                  <canvas ref={qrCanvasRef}></canvas>
                )}
              </div>
              <div className="sync-actions">
                <button onClick={onExportByFile} className="btn-secondary">Download Data as JSON File</button>
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-tertiary">Close</button>
        </div>
      </div>
    </div>
  );
};


const ImportResultModal = ({ results, onClose }: { results: ImportResults, onClose: () => void }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Import Complete</h2>
        <div className="import-summary">
          <p><strong>Added:</strong> {results.added}</p>
          <p><strong>Updated:</strong> {results.updated}</p>
          <p><strong>Skipped:</strong> {results.skipped.length}</p>
        </div>
        {results.skipped.length > 0 && (
          <div className="import-errors">
            <h3>Skipped Row Details</h3>
            <div className="error-list">
              {results.skipped.map(({ row, reason, data }) => (
                <div key={row} className="error-item">
                  <p><strong>Row {row}:</strong> {reason}</p>
                  <pre><code>{data}</code></pre>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose} className="btn-primary">OK</button>
        </div>
      </div>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);