const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const cors = require('cors'); 

const app = express();
const port = process.env.PORT || 10000;

// Enable CORS so your website can securely connect
app.use(cors()); 

// Serve static files (just in case you test it directly on Render)
app.use(express.static('public'));

// Process files in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.post('/merge', upload.array('pdfs', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length < 2) {
            return res.status(400).send('Please upload at least two PDF files.');
        }

        const mergedPdf = await PDFDocument.create();

        for (const file of req.files) {
            // Load the PDF. Ignore encryption helps bypass basic read-only locks
            const pdf = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        const mergedPdfBytes = await mergedPdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=Merged_Document.pdf');
        res.send(Buffer.from(mergedPdfBytes));

    } catch (error) {
        console.error('Backend Error:', error);
        // Send the actual error message back to the frontend so we can read it
        res.status(500).send(error.message || 'The server crashed while processing these specific files.');
    }
});

app.listen(port, () => {
    console.log(`PDF Merger backend listening on port ${port}`);
});
