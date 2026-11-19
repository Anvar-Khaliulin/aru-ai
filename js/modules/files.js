/*
---ARU-LAB.SPACE---ALMATY---2026---
File parser utility extracting textual content from PDF, DOCX, XLSX, and TXT uploads.
---chat.aru-lab.space---PWA---
*/
import { loadPdfJs, loadMammoth, loadXlsx } from './lazyLoader.js';

export const FileProcessor = {

    async parseFile(file) {
        const type = file.type || '';
        const lowerName = (file.name || '').toLowerCase();
        console.log(`Processing file: ${file.name} (${type})`);

        try {
            if (type === 'application/pdf' || lowerName.endsWith('.pdf')) {
                return await this.readPDF(file);
            }
            else if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx')) {
                return await this.readDOCX(file);
            }
            else if (lowerName.endsWith('.csv') || type === 'text/csv') {
                return await this.readText(file);
            }
            else if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || type === 'application/vnd.ms-excel' || lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
                return await this.readXLSX(file);
            }
            else if (type.startsWith('text/') || /\.(?:txt|md|js|ts|jsx|tsx|py|php|html|htm|css|json|xml|yaml|yml|sql|log|sh|env|ini|toml)$/.test(lowerName)) {
                return await this.readText(file);
            }
            else {
                throw new Error('Unsupported file type. Please upload PDF, DOCX, TXT, or XLSX.');
            }
        } catch (e) {
            console.error('File parsing error:', e);
            throw e;
        }
    },

    // Excel spreadsheet parsing utility (XLSX)
    async readXLSX(file) {
        await loadXlsx();
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer);
        let fullContent = '';

        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_csv(worksheet);
            fullContent += `[Sheet: ${sheetName}]\n${data}\n\n`;
        });

        return `FILE CONTENT (${file.name}):\n${fullContent}`;
    },

    // PDF document parsing utility
    async readPDF(file) {
        await loadPdfJs();
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        try {
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += `[Page ${i}]\n${pageText}\n\n`;
            }
        } finally {
            try { await pdf.destroy(); } catch (_) {}
        }
        return `FILE CONTENT (${file.name}):\n${fullText}`;
    },

    // Word document (DOCX) parsing utility
    async readDOCX(file) {
        await loadMammoth();
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        return `FILE CONTENT (${file.name}):\n${result.value}`;
    },

    // Plain text and code file parsing utility
    readText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(`FILE CONTENT (${file.name}):\n${e.target.result}`);
            reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }
};