// server.js
// A complete Node.js web application to convert .feature files to .docx

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, Table, TableCell, TableRow, HeadingLevel, WidthType, TextRun, AlignmentType } = require('docx');

// --- Configuration ---
const PORT = 3000;
const app = express();

// Use multer for handling file uploads in memory
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
    fileFilter: (req, file, cb) => {
        // Accept only .feature files
        if (path.extname(file.originalname).toLowerCase() === '.feature') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only .feature files are allowed.'), false);
        }
    }
});

// In-memory cache to store the generated docx buffer temporarily
const generatedDocs = new Map();

// --- Core Logic ---

/**
 * Parses a .feature file's content to extract scenarios.
 * @param {string} fileContent - The content of the .feature file.
 * @returns {Array<Object>} An array of scenario objects.
 */
function extractAllDataWithExamples(fileContent) {
    const lines = fileContent.split(/\r?\n/);
    const allData = [];
    let currentTags = "";
    let currentScenario = "";
    let currentSteps = [];
    let inScenarioBlock = false;

    const saveCurrentScenario = () => {
        if (currentScenario && currentSteps.length > 0) {
            allData.push({
                tags: currentTags,
                scenario: currentScenario,
                steps: currentSteps.join('\n'),
            });
        }
    };

    for (const line of lines) {
        const stripped = line.trim();
        if (!stripped || stripped.startsWith('#')) continue;

        if (stripped.startsWith('@')) {
            if (inScenarioBlock) {
                saveCurrentScenario();
                currentScenario = "";
                currentSteps = [];
                inScenarioBlock = false;
            }
            currentTags = stripped;
        } else if (stripped.toLowerCase().startsWith('scenario:') || stripped.toLowerCase().startsWith('scenario outline:')) {
            saveCurrentScenario();
            inScenarioBlock = true;
            currentSteps = [];
            const parts = stripped.split(/:(.*)/s);
            currentScenario = parts.length > 1 && parts[1] ? parts[1].trim() : '';
        } else if (inScenarioBlock) {
            currentSteps.push(stripped);
        }
    }
    saveCurrentScenario();
    return allData;
}

/**
 * Creates a .docx buffer from the extracted data.
 * @param {Array<Object>} data - The array of scenario objects.
 * @param {string} originalFilename - The original name of the feature file.
 * @returns {Promise<Buffer>} A promise that resolves with the .docx file buffer.
 */
async function createDocxBuffer(data, originalFilename) {
    if (!data.length) {
        throw new Error("No scenarios found in the feature file.");
    }

    const header = new TableRow({
        children: [
            new TableCell({ children: [new Paragraph({ text: "No", bold: true, alignment: AlignmentType.CENTER })], width: { size: 5, type: WidthType.PERCENTAGE } }),
            new TableCell({ children: [new Paragraph({ text: "Tags", bold: true })], width: { size: 15, type: WidthType.PERCENTAGE } }),
            new TableCell({ children: [new Paragraph({ text: "Scenario", bold: true })], width: { size: 25, type: WidthType.PERCENTAGE } }),
            new TableCell({ children: [new Paragraph({ text: "Steps", bold: true })], width: { size: 55, type: WidthType.PERCENTAGE } }),
        ],
        tableHeader: true,
    });

    const dataRows = data.map((rowData, idx) => {
        // Split steps string into paragraphs for better formatting in the cell
        const stepParagraphs = rowData.steps.split('\n').map(step => new Paragraph(step));

        return new TableRow({
            children: [
                new TableCell({ children: [new Paragraph({text: String(idx + 1), alignment: AlignmentType.CENTER })] }),
                new TableCell({ children: [new Paragraph(rowData.tags)] }),
                new TableCell({ children: [new Paragraph(rowData.scenario)] }),
                new TableCell({ children: stepParagraphs }),
            ],
        });
    });

    const table = new Table({
        rows: [header, ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
    });

    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({
                    text: `Feature: ${path.basename(originalFilename, '.feature')}`,
                    heading: HeadingLevel.HEADING_1,
                    alignment: AlignmentType.CENTER,
                }),
                new Paragraph(" "), // Spacer
                table,
            ],
        }],
    });

    return Packer.toBuffer(doc);
}


// --- Web Server (Express Routes) ---

// 1. Serve the main HTML page
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Feature File to DOCX Converter</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        @import url('https://rsms.me/inter/inter.css');
        html { font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11'; }

        .drop-zone {
            transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, transform 0.2s ease;
        }
        .drop-zone-over {
            border-color: #3b82f6; /* blue-500 */
            background-color: #f0f9ff; /* sky-50 */
            transform: scale(1.02);
        }
        .feedback-card {
            transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
        }
        .btn {
            transition: background-color 0.2s ease-in-out, transform 0.1s ease;
        }
        .btn:hover {
            transform: translateY(-2px);
        }
        .btn:active {
            transform: translateY(-1px);
        }
    </style>
</head>
<body class="bg-gray-100 text-gray-800 flex items-center justify-center min-h-screen p-4">

    <main class="w-full max-w-2xl mx-auto">
        <div class="bg-white rounded-xl shadow-md border border-gray-200/80 p-6 sm:p-10">
        
            <div class="text-center mb-8">
                <h1 class="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900">Feature to DOCX</h1>
                <p class="text-gray-500 mt-3 max-w-md mx-auto">Instantly convert your BDD <code class="bg-gray-200 text-gray-700 px-1.5 py-1 rounded-md text-sm">.feature</code> files into professionally formatted Word documents.</p>
            </div>

            <div id="uploadContainer" class="w-full">
                <input type="file" id="fileInput" class="hidden" accept=".feature">
                <label for="fileInput" id="dropZone" class="drop-zone flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100">
                    <div class="flex flex-col items-center justify-center text-center px-4">
                        <svg class="w-12 h-12 mb-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l-3 3m3-3l3-3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                        <p class="mb-2 text-lg text-gray-600"><span class="font-semibold text-blue-600">Click to upload</span> or drag and drop</p>
                        <p class="text-sm text-gray-500">Only a single .feature file is allowed</p>
                    </div>
                </label>
            </div>

            <!-- Visual Feedback Area -->
            <div id="feedbackContainer" class="feedback-container opacity-0 mt-6 text-center">
                <!-- Processing State -->
                <div id="processingState" class="hidden p-8">
                    <div role="status" class="flex items-center justify-center flex-col">
                        <svg aria-hidden="true" class="w-10 h-10 mb-4 text-gray-200 animate-spin fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/><path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0492C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5424 39.6781 93.9676 39.0409Z" fill="currentFill"/></svg>
                        <span class="text-xl text-gray-600 font-medium mt-4">Converting your file...</span>
                        <span class="text-gray-500">Please wait a moment.</span>
                    </div>
                </div>

                <!-- Success State -->
                <div id="successState" class="hidden feedback-card text-center bg-gray-50 p-6 sm:p-8 rounded-xl border border-gray-200">
                    <div class="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                        <svg class="w-8 h-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    </div>
                    <h3 class="text-2xl font-bold text-gray-800 mt-4">Conversion Complete!</h3>
                    <p class="text-gray-500 mt-2">Your document is ready for download.</p>
                    <p class="text-gray-600 my-4 break-words">File: <code id="fileName" class="bg-gray-200 text-gray-800 px-2 py-1 rounded-md"></code></p>
                    
                    <div class="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                        <a id="downloadBtn" href="#" class="btn w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                            <svg class="w-5 h-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                            Download DOCX
                        </a>
                        <button id="resetBtn" class="btn w-full sm:w-auto px-6 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300">Convert Another</button>
                    </div>
                </div>

                <!-- Error State -->
                <div id="errorState" class="hidden feedback-card text-center bg-red-50 p-6 sm:p-8 rounded-xl border border-red-200">
                     <div class="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                        <svg class="w-8 h-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </div>
                    <h3 class="text-2xl font-bold text-red-800 mt-4">Conversion Failed</h3>
                    <p id="errorMessage" class="text-red-600 mt-2 max-w-sm mx-auto"></p>
                    <button id="errorResetBtn" class="btn w-full sm:w-auto mt-6 px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700">Try Again</button>
                </div>
            </div>
            
        </div>
        <footer class="text-center mt-6">
            <p class="text-sm text-gray-500">Powered by Node.js & Express</p>
        </footer>
    </main>

<script>
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadContainer = document.getElementById('uploadContainer');
    const feedbackContainer = document.getElementById('feedbackContainer');
    
    const processingState = document.getElementById('processingState');
    const successState = document.getElementById('successState');
    const errorState = document.getElementById('errorState');
    
    const fileNameEl = document.getElementById('fileName');
    const downloadBtn = document.getElementById('downloadBtn');
    const resetBtn = document.getElementById('resetBtn');
    const errorResetBtn = document.getElementById('errorResetBtn');
    const errorMessageEl = document.getElementById('errorMessage');

    // --- UI State Management ---
    function showState(state) {
        uploadContainer.classList.add('hidden');
        feedbackContainer.classList.remove('opacity-0');
        
        [processingState, successState, errorState].forEach(el => el.classList.add('hidden'));
        
        if (state === 'processing') processingState.classList.remove('hidden');
        if (state === 'success') successState.classList.remove('hidden');
        if (state === 'error') errorState.classList.remove('hidden');
        if (state === 'initial') {
            uploadContainer.classList.remove('hidden');
            feedbackContainer.classList.add('opacity-0');
            fileInput.value = ''; // Reset file input
        }
    }

    // --- Event Listeners ---
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drop-zone-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drop-zone-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-zone-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });
    
    resetBtn.addEventListener('click', () => showState('initial'));
    errorResetBtn.addEventListener('click', () => showState('initial'));

    // --- File Handling Logic ---
    function handleFile(file) {
        if (!file.name.toLowerCase().endsWith('.feature')) {
            showError('Invalid file type. Please upload a .feature file.');
            return;
        }

        showState('processing');

        const formData = new FormData();
        formData.append('featureFile', file);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                 return response.json().then(err => { throw new Error(err.message || 'Server error') });
            }
            return response.json();
        })
        .then(data => {
            if (data.downloadUrl) {
                showSuccess(file.name, data.downloadUrl);
            } else {
                throw new Error(data.message || 'Unknown error during conversion.');
            }
        })
        .catch(error => {
            showError(error.message);
        });
    }
    
    function showSuccess(fileName, downloadUrl) {
        fileNameEl.textContent = fileName;
        downloadBtn.href = downloadUrl;
        showState('success');
    }

    function showError(message) {
        errorMessageEl.textContent = message;
        showState('error');
    }

</script>
</body>
</html>
    `);
});

// 2. Handle the file upload and conversion
app.post('/upload', (req, res) => {
    upload.single('featureFile')(req, res, async (err) => {
        if (err) {
            // This handles multer errors (e.g., file type)
            return res.status(400).json({ message: err.message });
        }
        
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        try {
            const fileContent = req.file.buffer.toString('utf-8');
            const data = extractAllDataWithExamples(fileContent);
            const docxBuffer = await createDocxBuffer(data, req.file.originalname);
            
            // Generate a unique ID for this document
            const docId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            
            // Store the buffer in our temporary cache
            generatedDocs.set(docId, {
                buffer: docxBuffer,
                filename: `${path.basename(req.file.originalname, '.feature')}.docx`
            });

            // Clean up the cache after some time (e.g., 10 minutes)
            setTimeout(() => {
                generatedDocs.delete(docId);
            }, 10 * 60 * 1000);

            res.json({ downloadUrl: `/download/${docId}` });

        } catch (error) {
            console.error('Conversion Error:', error);
            res.status(500).json({ message: error.message || 'Failed to process the file.' });
        }
    });
});

// 3. Handle the file download
app.get('/download/:id', (req, res) => {
    const docId = req.params.id;
    const docData = generatedDocs.get(docId);

    if (docData) {
        res.setHeader('Content-Disposition', `attachment; filename="${docData.filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(docData.buffer);
    } else {
        res.status(404).send('File not found or has expired. Please convert again.');
    }
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
