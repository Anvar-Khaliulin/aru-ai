/*
---ARU-LAB.SPACE---ALMATY---2026---
File parser utility extracting textual content from PDF, DOCX, XLSX, and TXT uploads.
---chat.aru-lab.space---PWA---
*/
export const FileProcessor = {

    async parseFile(file) {
        const type = file.type;
        console.log(`Processing file: ${file.name} (${type})`);

        try {
            if (type === 'application/pdf') {
                return await this.readPDF(file);
            }
            else if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                return await this.readDOCX(file);
            }
            else if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || type === 'application/vnd.ms-excel' || file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) {
                return await this.readXLSX(file);
            }
            else if (type.startsWith('text/') || file.name.endsWith('.js') || file.name.endsWith('.php') || file.name.endsWith('.html') || file.name.endsWith('.json')) {
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

    // Excel spreadsheet parsing utility (XLSX, CSV)
    async readXLSX(file) {
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
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += `[Page ${i}]\n${pageText}\n\n`;
        }
        return `FILE CONTENT (${file.name}):\n${fullText}`;
    },

    // Word document (DOCX) parsing utility
    async readDOCX(file) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        return `FILE CONTENT (${file.name}):\n${result.value}`;
    },

    // Plain text and code file parsing utility
    readText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(`FILE CONTENT (${file.name}):\n${e.target.result}`);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }
};