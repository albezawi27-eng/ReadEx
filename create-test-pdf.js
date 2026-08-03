// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');

// Minimal PDF content
const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 6 0 R >> >> /MediaBox [0 0 612 792] /Contents 7 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 6 0 R >> >> /MediaBox [0 0 612 792] /Contents 8 0 R >>
endobj
5 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 6 0 R >> >> /MediaBox [0 0 612 792] /Contents 9 0 R >>
endobj
6 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
7 0 obj
<< >>
stream
BT
/F1 12 Tf
50 700 Td
(ReadEx PDF Test - Page 1) Tj
0 -50 Td
(This is the first page with sample content) Tj
ET
endstream
endobj
8 0 obj
<< >>
stream
BT
/F1 12 Tf
50 700 Td
(Page 2 Content) Tj
0 -50 Td
(This is the second page with more text) Tj
ET
endstream
endobj
9 0 obj
<< >>
stream
BT
/F1 12 Tf
50 700 Td
(Page 3 Content) Tj
0 -50 Td
(Final page of the test PDF) Tj
ET
endstream
endobj
xref
0 10
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000290 00000 n 
0000000465 00000 n 
0000000640 00000 n 
0000000728 00000 n 
0000000856 00000 n 
0000000985 00000 n 
trailer
<< /Size 10 /Root 1 0 R >>
startxref
1114
%%EOF`;

fs.writeFileSync('test-sample.pdf', pdfContent);
console.log('Test PDF created successfully');
