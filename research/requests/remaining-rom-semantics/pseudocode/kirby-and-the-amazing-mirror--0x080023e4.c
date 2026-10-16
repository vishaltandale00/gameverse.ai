
void FUN_080023e4(uint param_1,uint param_2,uint param_3)

{
  int iVar1;
  code *UNRECOVERED_JUMPTABLE;
  
  iVar1 = (param_1 & 0xff) * 0x668;
                    /* WARNING: Could not recover jumptable at 0x08002424. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)
            (*(undefined1 *)
              ((uint)(*(ushort *)(iVar1 + 0x20235ec) >> 4) * (param_3 & 0xffff) + (param_2 & 0xffff)
               + (uint)*(byte *)(iVar1 + 0x2023b8e) * 0x79e + 0x2024ed0));
  return;
}

