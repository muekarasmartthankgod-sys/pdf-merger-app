const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Use memory storage so we don't save files to disk (better for cloud deployment)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Serve static files (like your frontend HTML/CSS) from a 'public' directory
app.use(express.static('public'));

app.post('/merge', upload.array('pdfs', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length < 2) {
            return res.status(400).send('Please upload at least two PDF files.');
        }

        // Create a new empty PDF Document
        const mergedPdf = await PDFDocument.create();

        // Loop through the uploaded files and merge them
        for (const file of req.files) {
            const pdf = await PDFDocument.load(file.buffer);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        // Serialize the merged PDF to bytes
        const mergedPdfBytes = await mergedPdf.save();

        // Set headers to trigger a file download in the browser
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=merged.pdf');
        res.send(Buffer.from(mergedPdfBytes));

    } catch (error) {
        console.error('Error merging PDFs:', error);
        res.status(500).send('An error occurred while merging the documents.');
    }
});

app.listen(port, () => {
    console.log(`PDF Merger app listening on port ${port}`);
});
