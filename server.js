const express = require('express');
const multer = require('multer');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const cors = require('cors'); 
const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');

const app = express();
const port = process.env.PORT || 10000;

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.use(cors()); 
app.use(express.json());
app.use(express.static('public'));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ---------------------------------------------------------
// TOOL 1: PDF Merger
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
        if (!req.file) return res.status(400).send('No rate sheet file uploaded.');
        const pdfData = await pdfParse(req.file.buffer);
        const extractedText = pdfData.text;
        if (!extractedText || extractedText.trim().length === 0) {
            return res.status(400).send('Could not read text from this PDF.');
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You are an expert freight logistics data analyst. Extract pricing lanes into a JSON structure with a single "rates" array key containing objects with: "Origin", "Destination", "Container_Size", "Base_Rate", "Currency", "Surcharges", "Validity".`
                },
                { role: "user", content: extractedText }
            ],
            temperature: 0.1
        });

        res.json(JSON.parse(response.choices[0].message.content));
    } catch (error) {
        console.error('Standardizer Error:', error);
        res.status(500).send(error.message || 'Error parsing rate sheet.');
    }
});

// ---------------------------------------------------------
// TOOL 3: Automated Document Generator (NEW!)
// ---------------------------------------------------------
app.post('/generate-invoice', async (req, res) => {
    try {
        const { invoiceNum, shipper, consignee, description, weight, value } = req.body;

        if (!invoiceNum || !shipper || !consignee) {
            return res.status(400).send('Missing required invoice fields.');
        }

        // Create a blank PDF document from scratch
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([600, 800]);
        const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Header Title
        page.drawText('COMMERCIAL INVOICE', { x: 50, y: 740, size: 24, font: helveticaBold, color: rgb(0.1, 0.2, 0.4) });
        
        // Invoice Meta Data
        page.drawText(`Invoice Number: ${invoiceNum}`, { x: 400, y: 745, size: 12, font: helveticaBold });
        page.drawText(`Date: ${new Date().toLocaleDateString()}`, { x: 400, y: 730, size: 11, font: helvetica });

        // Shipper & Consignee Columns
        page.drawText('SHIPPER / EXPORTER:', { x: 50, y: 680, size: 12, font: helveticaBold });
        page.drawText(shipper, { x: 50, y: 660, size: 11, font: helvetica, maxWidth: 220, lineHeight: 15 });

        page.drawText('CONSIGNEE / IMPORTER:', { x: 320, y: 680, size: 12, font: helveticaBold });
        page.drawText(consignee, { x: 320, y: 660, size: 11, font: helvetica, maxWidth: 220, lineHeight: 15 });

        // Table Borders & Headers
        page.drawRectangle({ x: 50, y: 500, width: 500, height: 30, color: rgb(0.9, 0.9, 0.95) });
        page.drawText('Description of Goods', { x: 60, y: 510, size: 11, font: helveticaBold });
        page.drawText('Weight (KG)', { x: 340, y: 510, size: 11, font: helveticaBold });
        page.drawText('Value (USD)', { x: 460, y: 510, size: 11, font: helveticaBold });

        // Table Rows (Data Inputted from Frontend)
        page.drawText(description || 'General Cargo', { x: 60, y: 475, size: 11, font: helvetica });
        page.drawText(weight || '0', { x: 340, y: 475, size: 11, font: helvetica });
        page.drawText(`$${value || '0.00'}`, { x: 460, y: 475, size: 11, font: helvetica });

        // Total Summary
        page.drawLine({ start: { x: 50, y: 440 }, end: { x: 550, y: 440 }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
        page.drawText('TOTAL DECLARED VALUE:', { x: 300, y: 415, size: 11, font: helveticaBold });
        page.drawText(`$${value || '0.00'}`, { x: 460, y: 415, size: 12, font: helveticaBold, color: rgb(0.8, 0.1, 0.1) });

        // Footer Certification text
        page.drawText('We hereby certify that this invoice is true and correct.', { x: 50, y: 150, size: 10, font: helvetica, style: 'italic' });

        const pdfBytes = await pdfDoc.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Invoice_${invoiceNum}.pdf`);
        res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Invoice Generator Error:', error);
        res.status(500).send(error.message || 'Error generating invoice document.');
    }
});

app.listen(port, () => {
    console.log(`Maitaf-AI Logistics Hub listening on port ${port}`);
});
