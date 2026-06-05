const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const cors = require('cors'); 
const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');

const app = express();
const port = process.env.PORT || 10000;

// Initialize OpenAI client using the secure environment variable
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.use(cors()); 
app.use(express.json());
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ---------------------------------------------------------
// TOOL 1: PDF Merger (Your working code)
// ---------------------------------------------------------
app.post('/merge', upload.array('pdfs', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length < 2) {
            return res.status(400).send('Please upload at least two PDF files.');
        }
        const mergedPdf = await PDFDocument.create();
        for (const file of req.files) {
            const pdf = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }
        const mergedPdfBytes = await mergedPdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=Merged_Document.pdf');
        res.send(Buffer.from(mergedPdfBytes));
    } catch (error) {
        console.error('Merge Error:', error);
        res.status(500).send(error.message || 'Error processing PDF merge.');
    }
});

// ---------------------------------------------------------
// TOOL 2: Carrier Rate Sheet Standardizer
// ---------------------------------------------------------
app.post('/standardize-rates', upload.single('rateSheet'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No rate sheet file uploaded.');
        }

        // 1. Extract raw text from the uploaded PDF
        const pdfData = await pdfParse(req.file.buffer);
        const extractedText = pdfData.text;

        if (!extractedText || extractedText.trim().length === 0) {
            return res.status(400).send('Could not read text from this PDF. Is it an un-scanned image?');
        }

        // 2. Send the raw text to OpenAI to parse tabular structures
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" }, // Forces structured output
            messages: [
                {
                    role: "system",
                    content: `You are an expert freight logistics data analyst. Analyze the raw text of the carrier rate sheet provided. 
                    Extract all individual pricing and freight lane rows.
                    You must return a JSON object containing a single key "rates" which maps to an array of objects.
                    Each object inside the "rates" array must strictly contain these keys:
                    - "Origin" (City/Port)
                    - "Destination" (City/Port)
                    - "Container_Size" (e.g., 20ft, 40ft, LCL, or N/A)
                    - "Base_Rate" (The numerical price value, e.g., 1200)
                    - "Currency" (e.g., USD, EUR, GBP)
                    - "Surcharges" (Any BAF, THC, or local fees found, or "None")
                    - "Validity" (Expiration date if found, or "Unknown")

                    If any column data is missing for a row, provide "N/A". Do not return any extra markdown text outside the JSON.`
                },
                {
                    role: "user",
                    content: extractedText
                }
            ],
            temperature: 0.1 // Low temperature keeps extraction accurate and factual
        });

        // 3. Send the structured JSON response back to the front-end
        const resultJson = JSON.parse(response.choices[0].message.content);
        res.json(resultJson);

    } catch (error) {
        console.error('Standardizer Error:', error);
        res.status(500).send(error.message || 'Error parsing rate sheet.');
    }
});

app.listen(port, () => {
    console.log(`Maitaf-AI Logistics Hub listening on port ${port}`);
});
