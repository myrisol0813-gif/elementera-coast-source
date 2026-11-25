package com.elementeracoast.app.core.local

import org.junit.Assert.*
import org.junit.Test

class CoastWordPieceTest {
    private val tokenizer=CoastWordPiece(listOf("[PAD]","[UNK]","[CLS]","[SEP]","雨","伞","hello","##s","!","cafe"))
    @Test fun chineseAccentsAndWordPieces(){
        assertArrayEquals(longArrayOf(2,4,5,6,7,8,9,3),tokenizer.encode("雨伞 HELLOs! Café"))
    }
    @Test fun unknownAndBoundedSequence(){
        assertArrayEquals(longArrayOf(2,1,3),tokenizer.encode("missing"))
        assertEquals(512,tokenizer.encode("雨".repeat(600)).size)
        assertEquals(3L,tokenizer.encode("雨".repeat(600)).last())
    }
}
