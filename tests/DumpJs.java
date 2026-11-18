import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Paths;
public class DumpJs {
  public static void main(String[] args) throws Exception {
    for (String name : new String[]{"INSPECT", "CLICK_CART", "RSI_CART_STEP", "SIGN_IN_STATUS"}) {
      Field field=ShopChecker.class.getDeclaredField(name);
      field.setAccessible(true);
      Files.writeString(Paths.get("build", name+".js"), (String)field.get(null));
    }
  }
}
