
void FUN_08150894(int *param_1,undefined4 param_2,undefined1 param_3,undefined2 param_4,
                 undefined2 param_5,undefined2 param_6,undefined1 param_7)

{
  undefined1 uVar1;
  undefined1 *puVar2;
  code *UNRECOVERED_JUMPTABLE;
  
  puVar2 = (undefined1 *)FUN_0815081c(param_1,param_4);
  if (puVar2 == (undefined1 *)0x0) {
    uVar1 = 0;
  }
  else {
    FUN_0815075c(param_2,param_3,puVar2,param_5,param_6,param_7,*(undefined1 *)(*param_1 + 8));
    uVar1 = *puVar2;
  }
                    /* WARNING: Could not recover jumptable at 0x081508fa. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)(uVar1);
  return;
}

