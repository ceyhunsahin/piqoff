import { core,dataset,datatable } from '../core.js';
import moment from 'moment';
import rsa from 'jsrsasign';
import { pem } from '../../../../pem.js';

export class nf525Cls
{
    constructor()
    {
        this.core = core.instance;
        //console.log(this.generatePem())
    }
    generatePem()
    {
        let keyObj = rsa.KEYUTIL.generateKeypair("EC", "secp256r1");

        let cert = new rsa.KJUR.asn1.x509.Certificate(
        {
            version: 1,
            serial: {int: 1},
            issuer: {str: "/CN=NF525"},
            notbefore: "202231235959Z",
            notafter:  "222231235959Z",
            subject: {str: "/CN=NF525"},
            sbjpubkey: keyObj.pubKeyObj, // can specify public key object or PEM string
            ext: [
              {extname: "basicConstraints", cA: false},
              {extname: "keyUsage", critical: true, names:["digitalSignature"]},
              {extname: "cRLDistributionPoints",
               array: [{fulluri: 'http://example.com/a.crl'}]}
            ],
            sigalg: "SHA256withECDSA",
            cakey: keyObj.prvKeyObj // can specify private key object or PEM string
          });
        
        return {
            private : rsa.KEYUTIL.getPEM(keyObj.prvKeyObj),
            public : rsa.KEYUTIL.getPEM(keyObj.pubKeyObj),
            certificate : cert.getPEM()
        }
    }
    sign(pData)
    {
        let sig = new rsa.KJUR.crypto.Signature({"alg": "SHA256withECDSA", "prov": "cryptojs/jsrsa"});
        sig.init(pem.private);
        sig.updateString(pData);
        let sigValueHex = rsa.hextob64u(sig.sign());
        // console.log(pData)
        // console.log(sigValueHex)
        // console.log(rsa.hextob64u(sigValueHex))
        // console.log(rsa.b64tohex(rsa.hextob64u(sigValueHex)))
        // this.verify(pData,rsa.b64tohex(rsa.hextob64u(sigValueHex)))
        return sigValueHex
    }
    verify(pData,pSig)
    {
        let sig = new rsa.KJUR.crypto.Signature({'alg':'SHA256withECDSA', "prov": "cryptojs/jsrsa"});
        sig.init(pem.public);
        sig.updateString(pData);
        let isValid = sig.verify(rsa.b64utohex(pSig));
        return isValid
    }
    async lastDocSignData(pData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastRef = 0
            let tmpLastSignature = ''

            let tmpQuery = 
            {
                query : "SELECT TOP 1 * FROM DOC_VW_01 WHERE DOC_TYPE IN (20,21) AND GUID <> @GUID AND TYPE = 1 AND SIGNATURE <> '' ORDER BY CDATE DESC",
                param : ['GUID:string|50'],
                value : [pData.GUID]
            }
            
            let tmpResult = await this.core.sql.execute(tmpQuery)

            if(typeof tmpResult.result.err == 'undefined' && tmpResult.result.recordset.length > 0)
            {
                if(tmpResult.result.recordset[0].REF_NO != null)
                {
                    tmpLastRef = tmpResult.result.recordset[0].REF_NO
                }
                if(tmpResult.result.recordset[0].SIGNATURE != null)
                {
                    tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                }
            }

            resolve (
            {
                REF : tmpLastRef,
                LAST_SIGN : tmpLastSignature
            })
        })
    }
    signatureDoc(pData,pSaleData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastData = await this.lastDocSignData(pData)
            let tmpSignature = ''
            let tmpSignatureSum = ''
            
            if(pSaleData.length > 0)
            {
                let tmpVatLst = pSaleData.where({GUID:{'<>':'00000000-0000-0000-0000-000000000000'}}).groupBy('VAT_RATE');
                    
                for (let i = 0; i < tmpVatLst.length; i++) 
                {
                    tmpSignatureSum = tmpSignatureSum + parseInt(Number(tmpVatLst[i].VAT_RATE) * 100).toString().padStart(4,'0') + ":" + parseInt(Number(pSaleData.where({VAT_TYPE:tmpVatLst[i].VAT_TYPE}).sum('TOTAL',2)) * 100).toString() + "|"
                }
                
                tmpSignatureSum = tmpSignatureSum.toString().substring(0,tmpSignatureSum.length - 1)
                tmpSignatureSum = tmpSignatureSum + "," + parseInt(Number(Number(pData.TOTAL).toFixed(2)) * 100).toString()
                tmpSignatureSum = tmpSignatureSum + "," + moment(pData.LDATE).format("YYYYMMDDHHmmss")
                tmpSignatureSum = tmpSignatureSum + "," + (Number(tmpLastData.REF) + 1).toString().padStart(8,'0') 
                tmpSignatureSum = tmpSignatureSum + "," + pData.TYPE_NAME
                tmpSignatureSum = tmpSignatureSum + "," + pData.INPUT_NAME
                tmpSignatureSum = tmpSignatureSum + "," + pData.ZIPCODE
                tmpSignatureSum = tmpSignatureSum + "," + pData.TAX_NO
                tmpSignatureSum = tmpSignatureSum + "," + (tmpLastData.LAST_SIGN == "" ? "N" : "O")
                tmpSignatureSum = tmpSignatureSum + "," + tmpLastData.LAST_SIGN

                tmpSignature = this.sign(tmpSignatureSum)
            }

            resolve({REF:Number(tmpLastData.REF) + 1,SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum})
        })
    }
    async lastSaleSignData(pData)
    {
        return new Promise(async resolve => 
        {
            if(!this.core.offline)
            {
                let tmpLastRef = 0
                let tmpLastSignature = ''
    
                let tmpQuery = 
                {
                    query : "SELECT REF,SIGNATURE FROM POS WHERE DEVICE = @DEVICE AND REF = (SELECT MAX(REF) FROM POS WHERE DEVICE = @DEVICE AND STATUS = 1 AND DELETED = 0) AND STATUS = 1 AND DELETED = 0",
                    param : ['DEVICE:string|25'],
                    value : [pData.DEVICE]
                }
                
                let tmpResult = await this.core.sql.execute(tmpQuery)
    
                if(typeof tmpResult.result.err == 'undefined' && tmpResult.result.recordset.length > 0)
                {
                    if(tmpResult.result.recordset[0].REF != null)
                    {
                        tmpLastRef = tmpResult.result.recordset[0].REF
                    }
                    if(tmpResult.result.recordset[0].SIGNATURE != null)
                    {
                        tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                    }
                }
                localStorage.setItem('REF_SALE',tmpLastRef)
                localStorage.setItem('SIG_SALE',tmpLastSignature)
            }
            
            resolve (
            {
                REF : typeof localStorage.getItem('REF_SALE') == 'undefined' ? 1 : localStorage.getItem('REF_SALE'),
                LAST_SIGN : typeof localStorage.getItem('SIG_SALE') == 'undefined' ? '' : localStorage.getItem('SIG_SALE')
            })
        })
    }
    signatureSale(pData,pSaleData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastData = await this.lastSaleSignData(pData)
            let tmpSignature = ''
            let tmpSignatureSum = ''
            
            if(pSaleData.length > 0)
            {
                let tmpVatLst = pSaleData.where({GUID:{'<>':'00000000-0000-0000-0000-000000000000'}}).groupBy('VAT_RATE');
                    
                for (let i = 0; i < tmpVatLst.length; i++) 
                {
                    tmpSignatureSum = tmpSignatureSum + parseInt(Number(tmpVatLst[i].VAT_RATE) * 100).toString().padStart(4,'0') + ":" + parseInt(Number(pSaleData.where({VAT_TYPE:tmpVatLst[i].VAT_TYPE}).sum('TOTAL',2)) * 100).toString() + "|"
                }
                
                tmpSignatureSum = tmpSignatureSum.toString().substring(0,tmpSignatureSum.length - 1)
                tmpSignatureSum = tmpSignatureSum + "," + parseInt(Number(Number(pData.TOTAL).toFixed(2)) * 100).toString()
                tmpSignatureSum = tmpSignatureSum + "," + moment(pData.LDATE).format("YYYYMMDDHHmmss")
                tmpSignatureSum = tmpSignatureSum + "," + pData.DEVICE + "" + (Number(tmpLastData.REF) + 1).toString().padStart(8,'0') 
                tmpSignatureSum = tmpSignatureSum + "," + pData.TYPE_NAME
                tmpSignatureSum = tmpSignatureSum + "," + (tmpLastData.LAST_SIGN == "" ? "N" : "O")
                tmpSignatureSum = tmpSignatureSum + "," + tmpLastData.LAST_SIGN
                
                tmpSignature = this.sign(tmpSignatureSum)
            }

            resolve({REF:Number(tmpLastData.REF) + 1,SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum})
        })
    }
    async lastSaleFactSignData(pData)
    {
        return new Promise(async resolve => 
        {
            if(!this.core.offline)
            {
                let tmpLastRef = 0
                let tmpLastSignature = ''
    
                let tmpQuery = 
                {
                    query : "SELECT TOP 1 * FROM [dbo].[POS_FACTURE_VW_01] WHERE DEVICE = @DEVICE ORDER BY LDATE DESC",
                    param : ['DEVICE:string|25'],
                    value : [pData.DEVICE]
                }
                
                let tmpResult = await this.core.sql.execute(tmpQuery)
    
                if(typeof tmpResult.result.err == 'undefined' && tmpResult.result.recordset.length > 0)
                {
                    if(tmpResult.result.recordset[0].FACT_REF != null)
                    {
                        tmpLastRef = tmpResult.result.recordset[0].FACT_REF
                    }
                    if(tmpResult.result.recordset[0].SIGNATURE != null)
                    {
                        tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                    }
                }
                localStorage.setItem('REF_SALE_FACT',tmpLastRef)
                localStorage.setItem('SIG_SALE_FACT',tmpLastSignature)
            }
            
            resolve (
            {
                REF : typeof localStorage.getItem('REF_SALE_FACT') == 'undefined' ? 1 : localStorage.getItem('REF_SALE_FACT'),
                LAST_SIGN : typeof localStorage.getItem('SIG_SALE_FACT') == 'undefined' ? '' : localStorage.getItem('SIG_SALE_FACT')
            })
        })
    }
    signatureSaleFact(pData,pSaleData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastData = await this.lastSaleFactSignData(pData)
            let tmpSignature = ''
            let tmpSignatureSum = ''
            
            if(pSaleData.length > 0)
            {
                let tmpVatLst = pSaleData.where({GUID:{'<>':'00000000-0000-0000-0000-000000000000'}}).groupBy('VAT_RATE');
                    
                for (let i = 0; i < tmpVatLst.length; i++) 
                {
                    tmpSignatureSum = tmpSignatureSum + parseInt(Number(tmpVatLst[i].VAT_RATE) * 100).toString().padStart(4,'0') + ":" + parseInt(Number(pSaleData.where({VAT_TYPE:tmpVatLst[i].VAT_TYPE}).sum('TOTAL',2)) * 100).toString() + "|"
                }
                
                tmpSignatureSum = tmpSignatureSum.toString().substring(0,tmpSignatureSum.length - 1)
                tmpSignatureSum = tmpSignatureSum + "," + parseInt(Number(Number(pData.TOTAL).toFixed(2)) * 100).toString()
                tmpSignatureSum = tmpSignatureSum + "," + moment(pData.LDATE).format("YYYYMMDDHHmmss")
                tmpSignatureSum = tmpSignatureSum + "," + pData.DEVICE + "" + (Number(tmpLastData.REF) + 1).toString().padStart(8,'0') 
                tmpSignatureSum = tmpSignatureSum + "," + pData.TYPE_NAME
                tmpSignatureSum = tmpSignatureSum + "," + (tmpLastData.LAST_SIGN == "" ? "N" : "O")
                tmpSignatureSum = tmpSignatureSum + "," + tmpLastData.LAST_SIGN
                
                tmpSignature = this.sign(tmpSignatureSum)

                localStorage.setItem('REF_SALE_FACT',Number(tmpLastData.REF) + 1)
                localStorage.setItem('SIG_SALE_FACT',tmpSignature)
            }

            resolve({REF:Number(tmpLastData.REF) + 1,SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum})
        })
    }
    signaturePosDuplicate(pData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastSignature = ''
            let tmpSignature = ''
            let tmpSignatureSum = ''
            let tmpPrintCount = 0

            let tmpQuery = 
            {
                query : "SELECT TOP 1 " +
                        "NF525.GUID, " +
                        "NF525.POS, " +
                        "NF525.PRINT_NO, " +
                        "NF525.LUSER, " +
                        "NF525.LDATE, " +
                        "NF525.SIGNATURE, " +
                        "NF525.SIGNATURE_SUM, " +
                        "NF525.APP_VERSION, " +
                        "NF525.DESCRIPTION, " +
                        "POS.REF, " +
                        "POS.TYPE_NAME, " +
                        "POS.DEVICE " +
                        "FROM NF525_POS_DUPLICATE_VW_01 AS NF525 " +
                        "INNER JOIN POS_VW_01 AS POS ON " +
                        "NF525.POS = POS.GUID " +
                        "WHERE NF525.POS = @POS ORDER BY NF525.PRINT_NO DESC",
                param : ['POS:string|50'],
                value : [pData.GUID]
            }
            
            let tmpResult = await this.core.sql.execute(tmpQuery)
            
            if(tmpResult.result.recordset.length > 0)
            {
                if(tmpResult.result.recordset[0].PRINT_NO != null)
                {
                    tmpPrintCount = tmpResult.result.recordset[0].PRINT_NO
                }
                if(tmpResult.result.recordset[0].SIGNATURE != null)
                {
                    tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                }
            }
            
            tmpSignatureSum = pData.GUID
            tmpSignatureSum = tmpSignatureSum + "," + pData.TYPE_NAME
            tmpSignatureSum = tmpSignatureSum + "," + tmpPrintCount + 1
            tmpSignatureSum = tmpSignatureSum + "," + pData.LUSER
            tmpSignatureSum = tmpSignatureSum + "," + moment(pData.LDATE).format("YYYYMMDDHHmmss")
            tmpSignatureSum = tmpSignatureSum + "," + pData.DEVICE + "" + pData.REF.toString().padStart(8,'0') 
            tmpSignatureSum = tmpSignatureSum + "," + (tmpLastSignature == "" ? "N" : "O")
            tmpSignatureSum = tmpSignatureSum + "," + tmpLastSignature

            tmpSignature = this.sign(tmpSignatureSum)
            
            resolve({SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum})
        })
    }
    signaturePosFactDuplicate(pData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastSignature = ''
            let tmpPrintCount = 0
            let tmpFactRef = 0
            let tmpSignatureSum = ''

            let tmpQuery = 
            {
                query : "SELECT TOP 1 " +
                        "NF525.GUID, " +
                        "NF525.POS, " +
                        "NF525.PRINT_NO, " +
                        "NF525.LUSER, " +
                        "NF525.LDATE, " +
                        "NF525.SIGNATURE, " +
                        "NF525.APP_VERSION, " +
                        "NF525.DESCRIPTION, " +
                        "POS.FACT_REF, " +
                        "POS.TYPE_NAME, " +
                        "POS.DEVICE " +
                        "FROM NF525_POS_FACT_DUPLICATE_VW_01 AS NF525 " +
                        "INNER JOIN POS_VW_01 AS POS ON " +
                        "NF525.POS = POS.GUID " +
                        "WHERE NF525.POS = @POS ORDER BY NF525.PRINT_NO DESC",
                param : ['POS:string|50'],
                value : [pData.GUID]
            }
            
            let tmpResult = await this.core.sql.execute(tmpQuery)
            
            if(tmpResult.result.recordset.length > 0)
            {
                if(pData.DEVICE == '9999')
                {
                    tmpFactRef = 9999
                }
                else
                {
                    tmpFactRef = tmpResult.result.recordset[0].FACT_REF
                }
                if(tmpResult.result.recordset[0].PRINT_NO != null)
                {
                    tmpPrintCount = tmpResult.result.recordset[0].PRINT_NO
                }
                if(tmpResult.result.recordset[0].SIGNATURE != null)
                {
                    tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                }
            }
            
            tmpSignatureSum = pData.GUID
            tmpSignatureSum = tmpSignatureSum + "," + pData.TYPE_NAME
            tmpSignatureSum = tmpSignatureSum + "," + tmpPrintCount + 1
            tmpSignatureSum = tmpSignatureSum + "," + pData.LUSER
            tmpSignatureSum = tmpSignatureSum + "," + moment(pData.LDATE).format("YYYYMMDDHHmmss")
            tmpSignatureSum = tmpSignatureSum + "," + pData.DEVICE + "" + tmpFactRef.toString().padStart(8,'0') 
            tmpSignatureSum = tmpSignatureSum + "," + (tmpLastSignature == "" ? "N" : "O")
            tmpSignatureSum = tmpSignatureSum + "," + tmpLastSignature

            let tmpSign = this.sign(tmpSignatureSum)

            resolve({SIGNATURE:tmpSign,SIGNATURE_SUM:tmpSignatureSum})
        })
    }
    signatureDocDuplicate(pData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastSignature = ''
            let tmpSignature = ''
            let tmpSignatureSum = ''
            let tmpPrintCount = 0

            let tmpQuery = 
            {
                query : "SELECT TOP 1 " +
                        "NF203.FAC_DUP_NID AS GUID, " +
                        "NF203.FAC_DUP_ORI_NUM AS DOC, " +
                        "NF203.FAC_DUP_PRN_NUM AS PRINT_NO, " +
                        "NF203.FAC_DUP_OPS_NID AS LUSER, " +
                        "NF203.FAC_DUP_HOR_GDH AS LDATE, " +
                        "NF203.FAC_DUP_SIG AS SIGNATURE, " +
                        "NF203.FAC_DUP_SIG_SUM AS SIGNATURE_SUM, " +
                        "NF203.FAC_DUP_VER AS APP_VERSION, " +
                        "NF203.FAC_DUP_TYP AS TYPE_NAME " +
                        "FROM NF203_DOC_DUPLICATE_VW_01 AS NF203 " +
                        "WHERE NF203.FAC_DUP_ORI_NUM = @DOC ORDER BY NF203.FAC_DUP_PRN_NUM DESC",
                param : ['DOC:string|50'],
                value : [pData.GUID]
            }
            
            let tmpResult = await this.core.sql.execute(tmpQuery)
            
            if(tmpResult.result.recordset.length > 0)
            {
                if(tmpResult.result.recordset[0].PRINT_NO != null)
                {
                    tmpPrintCount = tmpResult.result.recordset[0].PRINT_NO
                }
                if(tmpResult.result.recordset[0].SIGNATURE != null)
                {
                    tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                }
            }
            
            tmpSignatureSum = pData.GUID
            tmpSignatureSum = tmpSignatureSum + "," + pData.TYPE_NAME
            tmpSignatureSum = tmpSignatureSum + "," + tmpPrintCount + 1
            tmpSignatureSum = tmpSignatureSum + "," + pData.LUSER
            tmpSignatureSum = tmpSignatureSum + "," + moment(pData.LDATE).format("YYYYMMDDHHmmss")
            tmpSignatureSum = tmpSignatureSum + "," + pData.FAC_DUP_NID
            tmpSignatureSum = tmpSignatureSum + "," + (tmpLastSignature == "" ? "N" : "O")
            tmpSignatureSum = tmpSignatureSum + "," + tmpLastSignature

            tmpSignature = this.sign(tmpSignatureSum)
            
            resolve({SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum})
        })
    }
    signatureNoteDuplicate(pData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastSignature = ''
            let tmpSignature = ''
            let tmpSignatureSum = ''
            let tmpPrintCount = -1
            
            let tmpQuery = 
            {
                query : `SELECT TOP 1 TTC FROM NF525_NOTE WHERE REST = @REST`,
                param : ['REST:string|50'],
                value : [pData.REST]
            }
            
            let tmpResult = await this.core.sql.execute(tmpQuery)

            if(tmpResult.result.recordset.length > 0)
            {
                tmpQuery = 
                {
                    query : "SELECT TOP 1 PRINT_COUNT,SIGNATURE FROM NF525_NOTE_DUPLICATE WHERE REST = @REST ORDER BY PRINT_COUNT DESC",
                    param : ['REST:string|50'],
                    value : [pData.REST]
                }
                
                tmpResult = await this.core.sql.execute(tmpQuery)
                
                if(tmpResult.result.recordset.length > 0)
                {
                    if(tmpResult.result.recordset[0].PRINT_COUNT != null)
                    {
                        tmpPrintCount = tmpResult.result.recordset[0].PRINT_COUNT
                    }
                    if(tmpResult.result.recordset[0].SIGNATURE != null)
                    {
                        tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                    }
                }
                
                tmpSignatureSum = pData.GUID
                tmpSignatureSum = tmpSignatureSum + "," + pData.TYPE
                tmpSignatureSum = tmpSignatureSum + "," + tmpPrintCount + 1
                tmpSignatureSum = tmpSignatureSum + "," + pData.CUSER
                tmpSignatureSum = tmpSignatureSum + "," + moment(pData.CDATE).format("YYYYMMDDHHmmss")
                tmpSignatureSum = tmpSignatureSum + "," + pData.REF.toString().padStart(8,'0') 
                tmpSignatureSum = tmpSignatureSum + "," + (tmpLastSignature == "" ? "N" : "O")
                tmpSignatureSum = tmpSignatureSum + "," + tmpLastSignature

                tmpSignature = this.sign(tmpSignatureSum)                

                let tmpInsertQuery = 
                {
                    query : `EXEC [dbo].[PRD_NF525_NOTE_DUPLICATE_INSERT] 
                            @GUID = @PGUID, 
                            @CDATE = @PCDATE, 
                            @CUSER = @PCUSER, 
                            @REST = @PREST, 
                            @REF = @PREF, 
                            @TYPE = @PTYPE, 
                            @PRINT_COUNT = @PPRINT_COUNT, 
                            @DESCRIPTION = @PDESCRIPTION, 
                            @SIGNATURE = @PSIGNATURE, 
                            @SIGNATURE_SUM = @PSIGNATURE_SUM`,
                    param : ['PGUID:string|50','PCDATE:string|25','PCUSER:string|25','PREST:string|50','PREF:string|50','PTYPE:string|50',
                            'PPRINT_COUNT:int','PDESCRIPTION:string|max','PSIGNATURE:string|max','PSIGNATURE_SUM:string|max'],
                    value : [datatable.uuidv4(),moment(pData.CDATE).format('YYYY-MM-DD HH:mm:ss'),pData.CUSER,pData.REST,pData.REF,pData.TYPE,
                             tmpPrintCount + 1,'Le client a demandé un reçu',tmpSignature,tmpSignatureSum],
                }

                await this.core.sql.execute(tmpInsertQuery)
            }
            
            resolve({SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum,COUNT:tmpPrintCount + 1})
        })
    }
    signatureNote(pData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastSignature = ''
            let tmpSignature = ''
            let tmpSignatureSum = ''

            let tmpQuery = 
            {
                query : `SELECT TOP 1 SIGNATURE FROM NF525_NOTE ORDER BY CDATE DESC`
            }
            
            let tmpResult = await this.core.sql.execute(tmpQuery)            
            
            if(tmpResult.result.recordset.length > 0)
            {
                if(tmpResult.result.recordset[0].SIGNATURE != null)
                {
                    tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                }
            }

            tmpSignatureSum = pData.TVA
            tmpSignatureSum = tmpSignatureSum + "," + pData.TTC
            tmpSignatureSum = tmpSignatureSum + "," + moment(pData.CDATE).format("YYYYMMDDHHmmss")
            tmpSignatureSum = tmpSignatureSum + "," + pData.REST
            tmpSignatureSum = tmpSignatureSum + "," + pData.TYPE
            tmpSignatureSum = tmpSignatureSum + "," + (tmpLastSignature == "" ? "N" : "O")
            tmpSignatureSum = tmpSignatureSum + "," + tmpLastSignature

            tmpSignature = this.sign(tmpSignatureSum)

            tmpQuery = 
            {
                query : `SELECT TOP 1 TTC FROM NF525_NOTE WHERE REST = @REST`,
                param : ['REST:string|50'],
                value : [pData.REST]
            }
            
            tmpResult = await this.core.sql.execute(tmpQuery)
            
            if((tmpResult.result.recordset.length == 0) || (tmpResult.result.recordset[0].TTC != pData.TTC))
            {
                let tmpInsertQuery = 
                {
                    query : `EXEC [dbo].[PRD_NF525_NOTE_INSERT] 
                            @GUID = @PGUID, 
                            @CDATE = @PCDATE, 
                            @CUSER = @PCUSER, 
                            @REST = @PREST, 
                            @TYPE = @PTYPE, 
                            @TVA = @PTVA, 
                            @TTC = @PTTC, 
                            @APP_VERSION = @PAPP_VERSION,
                            @SIGNATURE = @PSIGNATURE, 
                            @SIGNATURE_SUM = @PSIGNATURE_SUM`,
                    param : ['PGUID:string|50','PCDATE:string|25','PCUSER:string|25','PREST:string|50','PTYPE:string|50','PTVA:float','PTTC:float','PAPP_VERSION:string|25','PSIGNATURE:string|max','PSIGNATURE_SUM:string|max'],
                    value : [datatable.uuidv4(),moment(pData.CDATE).format('YYYY-MM-DD HH:mm:ss'),pData.CUSER,pData.REST,pData.TYPE,pData.TVA,pData.TTC,pData.APP_VERSION,tmpSignature,tmpSignatureSum],
                }

                await this.core.sql.execute(tmpInsertQuery)   
            }
            
            resolve({SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum})
        })
    }
    signatureJustPay(pData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastSignature = ''
            let tmpSignature = ''
            let tmpSignatureSum = ''
            let tmpMaxRef = 0

            let tmpQuery = 
            {
                query : `SELECT TOP 1 SIGNATURE,SIGNATURE_SUM FROM NF525_JUSTPAY WHERE POS = @POS`,
                param : ['POS:string|50'],
                value : [pData.POS]
            }
            
            let tmpResult = await this.core.sql.execute(tmpQuery)

            if(tmpResult.result.recordset.length == 0)
            {
                tmpQuery = 
                {
                    query : `SELECT TOP 1 SIGNATURE FROM NF525_JUSTPAY ORDER BY CDATE DESC`
                }
                
                tmpResult = await this.core.sql.execute(tmpQuery)
                
                if(tmpResult.result.recordset.length > 0)
                {
                    if(tmpResult.result.recordset[0].SIGNATURE != null)
                    {
                        tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                    }
                }

                tmpQuery = 
                {
                    query : `SELECT ISNULL(MAX(REF),0) AS MAXREF FROM NF525_JUSTPAY`
                }

                tmpResult = await this.core.sql.execute(tmpQuery)
                
                if(tmpResult.result.recordset.length > 0)
                {
                    if(tmpResult.result.recordset[0].MAXREF != null)
                    {
                        tmpMaxRef = tmpResult.result.recordset[0].MAXREF
                    }
                }

                tmpSignatureSum = tmpMaxRef
                tmpSignatureSum = tmpSignatureSum + "," + pData.TTC
                tmpSignatureSum = tmpSignatureSum + "," + moment(pData.CDATE).format("YYYYMMDDHHmmss")
                tmpSignatureSum = tmpSignatureSum + "," + pData.POS
                tmpSignatureSum = tmpSignatureSum + "," + (tmpLastSignature == "" ? "N" : "O")
                tmpSignatureSum = tmpSignatureSum + "," + tmpLastSignature

                tmpSignature = this.sign(tmpSignatureSum)            
                
                
                let tmpInsertQuery = 
                {
                    query : `EXEC [dbo].[PRD_NF525_JUSTPAY_INSERT] 
                            @GUID = @PGUID, 
                            @CDATE = @PCDATE, 
                            @CUSER = @PCUSER, 
                            @POS = @PPOS,
                            @REF = @PREF,
                            @REPAS = @PREPAS,
                            @SIGNATURE = @PSIGNATURE, 
                            @SIGNATURE_SUM = @PSIGNATURE_SUM, 
                            @APP_VERSION = @PAPP_VERSION`,
                    param : ['PGUID:string|50','PCDATE:string|25','PCUSER:string|25','PPOS:string|50','PREF:string|50','PREPAS:string|50','PSIGNATURE:string|max','PSIGNATURE_SUM:string|max','PAPP_VERSION:string|25'],
                    value : [datatable.uuidv4(),moment(pData.CDATE).format('YYYY-MM-DD HH:mm:ss'),pData.CUSER,pData.POS,tmpMaxRef + 1,pData.REPAS,tmpSignature,tmpSignatureSum,pData.APP_VERSION],
                }

                await this.core.sql.execute(tmpInsertQuery)

                resolve({STATE:true,SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum,REF:tmpMaxRef + 1})
            }
            else
            {
                console.log(tmpResult)
                tmpSignature = tmpResult.result.recordset[0].SIGNATURE
                tmpSignatureSum = tmpResult.result.recordset[0].SIGNATURE_SUM
                resolve({STATE:false,SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum,REF:tmpMaxRef + 1})
            }
        })
    }
    signatureJustPayDuplicate(pData)
    {
        return new Promise(async resolve => 
        {
            let tmpLastSignature = ''
            let tmpSignature = ''
            let tmpSignatureSum = ''
            let tmpPrintCount = 0

            let tmpQuery = 
            {
                query : "SELECT TOP 1 PRINT_COUNT,SIGNATURE FROM NF525_JUSTPAY_DUPLICATE WHERE POS = @POS ORDER BY PRINT_COUNT DESC",
                param : ['POS:string|50'],
                value : [pData.POS]
            }
            
            let tmpResult = await this.core.sql.execute(tmpQuery)
            
            if(tmpResult.result.recordset.length > 0)
            {
                if(tmpResult.result.recordset[0].PRINT_COUNT != null)
                {
                    tmpPrintCount = tmpResult.result.recordset[0].PRINT_COUNT
                }
                if(tmpResult.result.recordset[0].SIGNATURE != null)
                {
                    tmpLastSignature = tmpResult.result.recordset[0].SIGNATURE
                }
            }
            
            tmpSignatureSum = pData.POS
            tmpSignatureSum = tmpSignatureSum + "," + pData.TYPE
            tmpSignatureSum = tmpSignatureSum + "," + tmpPrintCount + 1
            tmpSignatureSum = tmpSignatureSum + "," + pData.CUSER
            tmpSignatureSum = tmpSignatureSum + "," + moment(pData.CDATE).format("YYYYMMDDHHmmss")
            tmpSignatureSum = tmpSignatureSum + "," + (tmpLastSignature == "" ? "N" : "O")
            tmpSignatureSum = tmpSignatureSum + "," + tmpLastSignature

            tmpSignature = this.sign(tmpSignatureSum)                

            let tmpInsertQuery = 
            {
                query : `EXEC [dbo].[PRD_NF525_JUSTPAY_DUPLICATE_INSERT] 
                        @GUID = @PGUID, 
                        @CDATE = @PCDATE, 
                        @CUSER = @PCUSER, 
                        @POS = @PPOS, 
                        @TYPE = @PTYPE, 
                        @PRINT_COUNT = @PPRINT_COUNT, 
                        @DESCRIPTION = @PDESCRIPTION, 
                        @SIGNATURE = @PSIGNATURE, 
                        @SIGNATURE_SUM = @PSIGNATURE_SUM,
                        @APP_VERSION = @PAPP_VERSION`,
                param : ['PGUID:string|50','PCDATE:string|25','PCUSER:string|25','PPOS:string|50','PTYPE:string|50',
                        'PPRINT_COUNT:int','PDESCRIPTION:string|max','PSIGNATURE:string|max','PSIGNATURE_SUM:string|max','PAPP_VERSION:string|25'],
                value : [datatable.uuidv4(),moment(pData.CDATE).format('YYYY-MM-DD HH:mm:ss'),pData.CUSER,pData.POS,pData.TYPE,
                        tmpPrintCount + 1,'Le client a demandé un reçu',tmpSignature,tmpSignatureSum,pData.APP_VERSION],
            }

            await this.core.sql.execute(tmpInsertQuery)
            resolve({SIGNATURE:tmpSignature,SIGNATURE_SUM:tmpSignatureSum,COUNT:tmpPrintCount + 1})
        })
    }
}