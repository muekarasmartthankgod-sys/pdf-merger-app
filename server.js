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
// 1. PDF MERGER
// ---------------------------------------------------------
app.post('/merge', upload.array('pdfs', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length < 2) return res.status(400).send('Upload at least 2 PDFs.');
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
        res.status(500).send(error.message || 'Error processing PDF merge.');
    }
});

// ---------------------------------------------------------
// 2. RATE STANDARDIZER
// ---------------------------------------------------------
app.post('/standardize-rates', upload.single('rateSheet'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded.');
        const pdfData = await pdfParse(req.file.buffer);
        if (!pdfData.text || pdfData.text.trim().length === 0) return res.status(400).send('Could not read text.');

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: `Extract pricing lanes into a JSON structure: {"rates": [{"Origin", "Destination", "Container_Size", "Base_Rate", "Currency", "Surcharges", "Validity"}]}` },
                { role: "user", content: pdfData.text }
            ],
            temperature: 0.1
        });
        res.json(JSON.parse(response.choices[0].message.content));
    } catch (error) {
        res.status(500).send(error.message || 'Error parsing rate sheet.');
    }
});

// ---------------------------------------------------------
// 3. MULTI-ITEM INVOICE GENERATOR
// ---------------------------------------------------------
app.post('/generate-invoice', async (req, res) => {
    try {
        const { invoiceNum, shipper, consignee, items } = req.body;
        if (!invoiceNum || !shipper || !consignee || !items || items.length === 0) {
            return res.status(400).send('Missing required fields or items.');
        }

        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([600, 800]);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Headers & Addresses
        page.drawText('COMMERCIAL INVOICE', { x: 50, y: 740, size: 24, font: fontBold, color: rgb(0.1, 0.2, 0.4) });
        page.drawText(`Invoice Number: ${invoiceNum}`, { x: 400, y: 745, size: 12, font: fontBold });
        page.drawText(`Date: ${new Date().toLocaleDateString()}`, { x: 400, y: 730, size: 11, font: fontReg });
        
        page.drawText('SHIPPER / EXPORTER:', { x: 50, y: 680, size: 12, font: fontBold });
        page.drawText(shipper, { x: 50, y: 660, size: 11, font: fontReg, maxWidth: 220, lineHeight: 15 });
        page.drawText('CONSIGNEE / IMPORTER:', { x: 320, y: 680, size: 12, font: fontBold });
        page.drawText(consignee, { x: 320, y: 660, size: 11, font: fontReg, maxWidth: 220, lineHeight: 15 });

        // Table Header
        page.drawRectangle({ x: 50, y: 500, width: 500, height: 30, color: rgb(0.9, 0.9, 0.95) });
        page.drawText('Description of Goods', { x: 60, y: 510, size: 11, font: fontBold });
        page.drawText('Weight (KG)', { x: 340, y: 510, size: 11, font: fontBold });
        page.drawText('Value (USD)', { x: 460, y: 510, size: 11, font: fontBold });

        // Loop through items and draw rows
        let currentY = 475;
        let totalValue = 0;
        
        items.forEach((item) => {
            page.drawText(item.desc || 'General Cargo', { x: 60, y: currentY, size: 10, font: fontReg });
            page.drawText(String(item.wt || '0'), { x: 340, y: currentY, size: 10, font: fontReg });
            page.drawText(`$${item.val || '0.00'}`, { x: 460, y: currentY, size: 10, font: fontReg });
            
            totalValue += Number(item.val || 0);
            currentY -= 20; // Move down 20 pixels for the next row
        });

        // Totals
        currentY -= 10;
        page.drawLine({ start: { x: 50, y: currentY }, end: { x: 550, y: currentY }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
        page.drawText('TOTAL DECLARED VALUE:', { x: 300, y: currentY - 25, size: 11, font: fontBold });
        page.drawText(`$${totalValue.toFixed(2)}`, { x: 460, y: currentY - 25, size: 12, font: fontBold, color: rgb(0.8, 0.1, 0.1) });

        const pdfBytes = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/
