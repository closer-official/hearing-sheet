// api/send.js
import { Resend } from 'resend';
import PDFDocument from 'pdfkit';

// Vercel上の環境変数からResendのAPIキーを読み込みます
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
    // POSTリクエスト以外は弾く
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const data = req.body;

        // 1. メモリ上でPDF契約書（暫定）を生成
        const doc = new PDFDocument({ margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        
        return new Promise((resolve) => {
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);

                // 2. Resend APIを使って「Divizero運営代表メール」へ送信
                // ※宛先（to）は薫之介さんの受信可能なアドレスに書き換えてください
                const emailResponse = await resend.emails.send({
                    from: 'Divizero System <onboarding@resend.dev>', // 本番は独自ドメインに設定可能
                    to: 'info@closer-official.com', // 👈ここに運営代表メールアドレスを入れてください
                    subject: `【要対応】契約書発行依頼_${data.name}様`,
                    html: `
                        <h2>Divizero パートナーシップ申請届</h2>
                        <p>ヒアリングシートより新しい送信がありました。内容を確認し、GMOサインにて署名手続きを進めてください。</p>
                        <hr />
                        <p><strong>お名前:</strong> ${data.name}</p>
                        <p><strong>メールアドレス:</strong> ${data.email}</p>
                        <p><strong>インスタURL:</strong> ${data.insta_url}</p>
                        <p><strong>策定プラン:</strong> 単価 ¥${parseInt(data.price).toLocaleString()} / アポ単価 ¥${parseInt(data.apo_fee).toLocaleString()} / コミッション ${data.com_rate}%</p>
                        <hr />
                        <p>※詳細な回答内容は添付のPDF契約書（ドラフト）をご確認ください。</p>
                    `,
                    attachments: [
                        {
                            filename: `Agreement_Draft_${data.name}.pdf`,
                            content: pdfBuffer.toString('base64'),
                        }
                    ]
                });

                res.status(200).json({ success: true, message: 'Email and PDF sent successfully', info: emailResponse });
                resolve();
            });

            // --- PDFのデザイン・中身の書き込み ---
            // 日本語フォントを適用（文字化け対策）
            doc.font('HeiseiMin-W3');

            doc.fontSize(20).text('Divizero パートナーシッププラン合意書 (ドラフト)', { align: 'center' });
            doc.moveDown();
            doc.fontSize(11).text(`作成日: ${new Date().toLocaleDateString('ja-JP')}`);
            doc.text(`申請者（甲）: ${data.name} 様`);
            doc.text(`運営者（乙）: Divizero 運営代表`);
            doc.moveDown();
            doc.text('==================================================================');
            doc.moveDown();
            doc.fontSize(13).text(`【合意されたプランパラメータ】`);
            doc.fontSize(11).text(`・想定制作単価の目安: ${parseInt(data.price).toLocaleString()} 円`);
            doc.text(`--------- 希望アポ単価: ${parseInt(data.apo_fee).toLocaleString()} 円`);
            doc.text(`--------- 成約コミッション率: ${data.com_rate} %`);
            doc.text(`--------- 月間アポ件数: ${data.apo_count} 件`);
            doc.moveDown();
            doc.fontSize(13).text(`【報酬受取・手数料精算サイクル】`);
            doc.fontSize(11).text(`・甲の報酬受取タイミング: ${data.payment_timing}`);
            doc.text(`・Divizeroへの精算サイクル: ${data.divizero_timing}`);
            doc.moveDown();

            // Vercelの環境変数から銀行情報を取得（登録がない場合のセーフティ付き）
            const bankName = process.env.BANK_NAME || '（未設定）';
            const bankBranch = process.env.BANK_BRANCH || '（未設定）';
            const bankType = process.env.BANK_ACCOUNT_TYPE || '普通';
            const bankNumber = process.env.BANK_ACCOUNT_NUMBER || '（未設定）';
            const bankAccountName = process.env.BANK_ACCOUNT_NAME || '（未設定）';

            doc.fontSize(13).text(`【手数料のお振込先口座】`);
            doc.fontSize(11).text(`・金融機関名: ${bankName}`);
            doc.text(`・支店名: ${bankBranch}`);
            doc.text(`・預金種目: ${bankType}`);
            doc.text(`・口座番号: ${bankNumber}`);
            doc.text(`・口座名義: ${bankAccountName}`);
            doc.moveDown();
            doc.fontSize(13).text(`【不正成約に関する罰則規定】`);
            doc.fontSize(10).text(`万が一、成約が発生したにもかかわらず成約していないと虚偽の申告をされた場合、発覚時点での設定成約コミッション単価の10倍をDivizeroへお支払いいただきます。本規定はプラン合意時点で効力が生じます。`);
            doc.moveDown(2);
            doc.text('上記内容に基づき、乙から甲へGMOサインを通じて正式な電子契約書を締結します。', { color: 'gray' });
            
            doc.end();
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}