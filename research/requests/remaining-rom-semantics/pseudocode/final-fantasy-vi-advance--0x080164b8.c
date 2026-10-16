
void FUN_080164b8(undefined4 param_1,undefined4 param_2,int param_3)

{
  byte bVar1;
  byte bVar2;
  byte bVar3;
  byte bVar4;
  byte bVar5;
  byte bVar6;
  byte bVar7;
  undefined4 *unaff_r5;
  byte *unaff_r6;
  
  *unaff_r6 = bRam02000537;
  *unaff_r6 = *unaff_r6 & 3;
  *(undefined2 *)(unaff_r6 + 4) = *(undefined2 *)unaff_r6;
  *unaff_r6 = (&UNK_080162f8)[*(ushort *)(unaff_r6 + 4)];
  bRam02000089 = *unaff_r6;
  *unaff_r6 = bRam02000537;
  bVar1 = *unaff_r6;
  *unaff_r6 = bVar1 >> 2;
  *unaff_r6 = *unaff_r6 & 3;
  *(undefined2 *)(unaff_r6 + 4) = *(undefined2 *)unaff_r6;
  *unaff_r6 = (&UNK_080162f8)[*(ushort *)(unaff_r6 + 4)];
  bRam02000088 = *unaff_r6;
  *unaff_r6 = bRam02000537;
  bVar2 = *unaff_r6;
  *unaff_r6 = bVar2 >> 4;
  *unaff_r6 = *unaff_r6 & 3;
  *(undefined2 *)(unaff_r6 + 4) = *(undefined2 *)unaff_r6;
  *unaff_r6 = (&UNK_080162f8)[*(ushort *)(unaff_r6 + 4)];
  bRam02000087 = *unaff_r6;
  *unaff_r6 = bRam02000537;
  bVar3 = *unaff_r6;
  *unaff_r6 = bVar3 >> 6;
  *(undefined2 *)(unaff_r6 + 4) = *(undefined2 *)unaff_r6;
  *unaff_r6 = (&UNK_080162f8)[*(ushort *)(unaff_r6 + 4)];
  bRam02000086 = *unaff_r6;
  *unaff_r6 = bRam02000538;
  bVar4 = *unaff_r6;
  *unaff_r6 = bVar4 >> 4;
  *unaff_r6 = *unaff_r6 & 3;
  *(undefined2 *)(unaff_r6 + 4) = *(undefined2 *)unaff_r6;
  *unaff_r6 = (&UNK_080162f8)[*(ushort *)(unaff_r6 + 4)];
  bRam0200008b = *unaff_r6;
  *unaff_r6 = bRam02000538;
  bVar5 = *unaff_r6;
  *unaff_r6 = bVar5 >> 6;
  *(undefined2 *)(unaff_r6 + 4) = *(undefined2 *)unaff_r6;
  *unaff_r6 = (&UNK_080162f8)[*(ushort *)(unaff_r6 + 4)];
  bRam0200008a = *unaff_r6;
  *unaff_r6 = bRam02000538;
  *unaff_r6 = *unaff_r6 & 1;
  bRam02000591 = *unaff_r6;
  *unaff_r6 = bRam02000538;
  bVar6 = *unaff_r6;
  *unaff_r6 = bVar6 >> 1;
  *unaff_r6 = *unaff_r6 & 1;
  bRam02000592 = *unaff_r6;
  *unaff_r6 = bRam02000538;
  bVar7 = *unaff_r6;
  *unaff_r6 = bVar7 >> 1;
  *unaff_r6 = *unaff_r6 & 1;
  bRam02000593 = *unaff_r6;
                    /* WARNING: Could not recover jumptable at 0x08016698. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*(code *)*unaff_r5)
            (bRam02000593,(code *)*unaff_r5,
             ((((((param_3 * 2 + (uint)((bVar1 >> 1 & 1) != 0)) * 2 + (uint)((bVar2 >> 3 & 1) != 0))
                 * 2 + (uint)((bVar3 >> 5 & 1) != 0)) * 2 + (uint)((bVar4 >> 3 & 1) != 0)) * 2 +
              (uint)((bVar5 >> 5 & 1) != 0)) * 2 + (uint)((bVar6 & 1) != 0)) * 2 +
             (uint)((bVar7 & 1) != 0));
  return;
}

